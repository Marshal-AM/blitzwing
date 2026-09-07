import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { HOME_DIR, VENV_PATH, SHARD_PORT, PETALS_PORT } from "./config.js";
import { which } from "./net.js";

function venvPython() {
  if (process.platform === "win32") {
    return path.join(VENV_PATH, "Scripts", "python.exe");
  }
  return path.join(VENV_PATH, "bin", "python");
}

function venvPip() {
  if (process.platform === "win32") {
    return path.join(VENV_PATH, "Scripts", "pip.exe");
  }
  return path.join(VENV_PATH, "bin", "pip");
}

function pythonVersion(bin) {
  try {
    const ver = execFileSync(bin, ["--version"], { encoding: "utf8" }).trim();
    const m = ver.match(/Python (\d+)\.(\d+)/);
    if (!m) return null;
    return { ver, major: Number(m[1]), minor: Number(m[2]) };
  } catch {
    return null;
  }
}

function isPetalsCompatible(info) {
  return info && info.major === 3 && info.minor >= 10 && info.minor <= 11;
}

function pinnedPythonPath() {
  try {
    const p = path.join(HOME_DIR, "python");
    if (!fs.existsSync(p)) return null;
    const bin = fs.readFileSync(p, "utf8").trim();
    return bin || null;
  } catch {
    return null;
  }
}

export function ensurePython() {
  // Petals/hivemind break on 3.12+. Never fall back to a too-new interpreter.
  const home = process.env.HOME || process.env.USERPROFILE || "";
  const candidates = [];
  const envBin = process.env.BLITZWING_PYTHON || process.env.PETALS_PYTHON;
  if (envBin) candidates.push(envBin);
  const pinned = pinnedPythonPath();
  if (pinned) candidates.push(pinned);
  if (process.env.CONDA_PREFIX) {
    candidates.push(
      path.join(process.env.CONDA_PREFIX, "bin", "python3.11"),
      path.join(process.env.CONDA_PREFIX, "bin", "python3.10"),
      path.join(process.env.CONDA_PREFIX, "bin", "python")
    );
  }
  for (const root of ["miniforge3", "mambaforge", "miniconda", "miniconda3", "anaconda3"]) {
    candidates.push(
      path.join(home, root, "envs", "blitzwing", "bin", "python3.11"),
      path.join(home, root, "envs", "blitzwing", "bin", "python")
    );
  }
  candidates.push("python3.11", "python3.10");

  const tried = [];
  const seen = new Set();
  for (const cmd of candidates) {
    if (!cmd || seen.has(cmd)) continue;
    seen.add(cmd);
    const found = cmd.includes("/") || cmd.includes("\\") ? (fs.existsSync(cmd) ? cmd : null) : which(cmd);
    if (!found) {
      tried.push(`${cmd} (missing)`);
      continue;
    }
    const info = pythonVersion(found);
    if (isPetalsCompatible(info)) {
      fs.mkdirSync(HOME_DIR, { recursive: true });
      fs.writeFileSync(path.join(HOME_DIR, "python"), found + "\n");
      return { py: found, ver: info.ver };
    }
    tried.push(`${found} (${info ? info.ver : "unreadable"})`);
  }

  throw new Error(
    "Python 3.10 or 3.11 is required (3.12+ will not work).\n" +
      "Checked:\n  - " +
      tried.slice(0, 12).join("\n  - ") +
      "\nFix:\n" +
      "  curl -LsSf https://astral.sh/uv/install.sh | sh && source $HOME/.local/bin/env\n" +
      "  uv python install 3.11\n" +
      "  export BLITZWING_PYTHON=\"$(uv python find 3.11)\"\n" +
      "  mkdir -p ~/.blitzwing && echo \"$BLITZWING_PYTHON\" > ~/.blitzwing/python\n" +
      "  blitzwing"
  );
}

function petalsImportable(python) {
  try {
    execFileSync(
      python,
      ["-c", "import petals.cli.run_server"],
      { stdio: "ignore" }
    );
    return true;
  } catch {
    return false;
  }
}

function uvicornImportable(python) {
  try {
    execFileSync(python, ["-c", "import uvicorn, fastapi"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function ensureShardManagerDeps(python, pip, env, onLog) {
  if (uvicornImportable(python)) return;
  onLog?.("Installing shard manager deps (uvicorn, fastapi)...");
  execFileSync(python, ["-m", "pip", "install", "fastapi", "uvicorn[standard]", "pydantic"], {
    stdio: "inherit",
    env,
  });
}

export function ensureVenvAndPetals({ onLog }) {
  const { py } = ensurePython();
  fs.mkdirSync(HOME_DIR, { recursive: true });

  if (!fs.existsSync(venvPython())) {
    onLog?.(`Creating venv at ${VENV_PATH}`);
    execFileSync(py, ["-m", "venv", VENV_PATH], { stdio: "inherit" });
  }

  const pip = venvPip();
  const python = venvPython();
  const env = {
    ...process.env,
    PIP_NO_BUILD_ISOLATION: "1",
  };

  if (petalsImportable(python)) {
    ensureShardManagerDeps(python, pip, env, onLog);
    onLog?.("Petals already installed — skipping dependency install");
    fs.writeFileSync(path.join(HOME_DIR, "python"), python + "\n");
    return { python, pip };
  }

  if (process.platform === "win32") {
    throw new Error(
      "Petals cannot be installed on native Windows (hivemind requires uvloop/Linux).\n" +
        "Run the contributor inside WSL instead:\n" +
        "  wsl bash /mnt/c/Users/MSI/Desktop/blitzwing/scripts/local_wsl_contributor_join.sh\n" +
        "Or run the full E2E script:\n" +
        "  powershell -File scripts/run_local_e2e.ps1"
    );
  }

  onLog?.("Installing CPU PyTorch + Petals (may take a few minutes on first run)...");
  execFileSync(python, ["-m", "pip", "install", "-U", "pip", "wheel", "setuptools<81"], {
    stdio: "inherit",
    env,
  });
  execFileSync(
    python,
    ["-m", "pip", "install", "torch", "--index-url", "https://download.pytorch.org/whl/cpu"],
    { stdio: "inherit", env }
  );
  // Needed to compile hivemind protobufs during --no-build-isolation install
  execFileSync(python, ["-m", "pip", "install", "grpcio", "grpcio-tools", "protobuf"], {
    stdio: "inherit",
    env,
  });
  // Hivemind first with no build isolation (needs pkg_resources from setuptools<81)
  execFileSync(
    python,
    [
      "-m",
      "pip",
      "install",
      "--no-build-isolation",
      "git+https://github.com/learning-at-home/hivemind.git@213bff98a62accb91f254e2afdccbf1d69ebdea9",
    ],
    { stdio: "inherit", env }
  );
  execFileSync(
    python,
    ["-m", "pip", "install", "--no-build-isolation", "git+https://github.com/bigscience-workshop/petals.git"],
    { stdio: "inherit", env }
  );
  execFileSync(python, ["-m", "pip", "install", "fastapi", "uvicorn[standard]", "pydantic", "httpx"], {
    stdio: "inherit",
    env,
  });

  fs.writeFileSync(path.join(HOME_DIR, "python"), python + "\n");
  return { python, pip };
}

/**
 * Write a tiny local shard-manager runner script so contributors don't need the monorepo.
 * Embeds a minimal supervisor compatible with mother /reload API.
 */
export function writeLocalShardManager() {
  const dir = path.join(HOME_DIR, "runtime");
  fs.mkdirSync(dir, { recursive: true });
  const appPath = path.join(dir, "shard_manager_app.py");
  const code = `
import os, signal, subprocess, threading, time
from typing import Optional, List
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

class ReloadRequest(BaseModel):
    block_indices: str = Field(..., pattern=r"^\\d+:\\d+$")

class StatusResponse(BaseModel):
    running: bool
    pid: Optional[int] = None
    block_indices: Optional[str] = None
    model: str
    public_ip: Optional[str] = None
    port: int
    last_exit_code: Optional[int] = None

class Mgr:
    def __init__(self):
        self.model = os.environ["MODEL_NAME"]
        self.public_ip = os.environ.get("PUBLIC_IP")
        self.port = int(os.environ.get("PETALS_PORT", "31337"))
        self.identity_path = os.environ.get("IDENTITY_PATH", os.path.expanduser("~/.blitzwing/petals-identity"))
        self.block_indices = os.environ["BLOCK_INDICES"]
        peers = [p.strip() for p in os.environ.get("INITIAL_PEERS", "").split(",") if p.strip()]
        self.initial_peers = peers
        announce_raw = os.environ.get("ANNOUNCE_MADDRS", "")
        self.announce_maddrs = [a.strip() for a in announce_raw.split(",") if a.strip()]
        self.python = os.environ.get("PETALS_PYTHON", "python")
        self.petals_log = os.environ.get("PETALS_LOG", os.path.expanduser("~/.blitzwing/petals.log"))
        self._proc = None
        self._log_fp = None
        self._lock = threading.Lock()
        self.last_exit_code = None

    def cmd(self, bi):
        c = [self.python, "-m", "petals.cli.run_server", self.model,
             "--device", "cpu", "--quant_type", "none",
             "--block_indices", bi, "--port", str(self.port),
             "--identity_path", self.identity_path, "--num_handlers", "1"]
        if self.announce_maddrs:
            c += ["--announce_maddrs", *self.announce_maddrs]
        elif self.public_ip:
            c += ["--public_ip", self.public_ip]
        if self.initial_peers:
            c += ["--initial_peers", *self.initial_peers]
        return c

    def start(self, bi=None):
        with self._lock:
            if bi: self.block_indices = bi
            if self._proc and self._proc.poll() is None:
                return
            if self._log_fp is None:
                os.makedirs(os.path.dirname(self.petals_log) or ".", exist_ok=True)
                self._log_fp = open(self.petals_log, "a", encoding="utf-8")
            popen_kwargs = {"stdout": self._log_fp, "stderr": subprocess.STDOUT}
            if os.name == "nt":
                popen_kwargs["creationflags"] = subprocess.CREATE_NEW_PROCESS_GROUP
            else:
                popen_kwargs["preexec_fn"] = os.setsid
            self._proc = subprocess.Popen(self.cmd(self.block_indices), **popen_kwargs)
            self.last_exit_code = None

    def stop(self):
        with self._lock:
            if not self._proc or self._proc.poll() is not None:
                self._proc = None
                return
            p = self._proc
            try:
                if os.name == "nt":
                    p.send_signal(signal.CTRL_BREAK_EVENT)
                else:
                    os.killpg(os.getpgid(p.pid), signal.SIGTERM)
            except Exception:
                p.send_signal(signal.SIGTERM)
            try: p.wait(timeout=30)
            except Exception:
                p.kill(); p.wait(timeout=10)
            self.last_exit_code = p.returncode
            self._proc = None

    def reload(self, bi):
        self.stop(); time.sleep(1); self.start(bi)

    def status(self):
        if self._proc is not None and self._proc.poll() is not None:
            self.last_exit_code = self._proc.returncode
            self._proc = None
        running = self._proc is not None and self._proc.poll() is None
        return StatusResponse(
            running=running,
            pid=(self._proc.pid if running else None),
            block_indices=self.block_indices,
            model=self.model,
            public_ip=self.public_ip,
            port=self.port,
            last_exit_code=self.last_exit_code,
        )

mgr = Mgr()
app = FastAPI()

@app.on_event("startup")
def _up():
    mgr.start()

@app.on_event("shutdown")
def _down():
    mgr.stop()

@app.get("/status")
def status():
    return mgr.status()

@app.post("/reload")
def reload(body: ReloadRequest):
    a,b = map(int, body.block_indices.split(":"))
    if b <= a: raise HTTPException(400, "bad range")
    mgr.reload(body.block_indices)
    time.sleep(0.5)
    return mgr.status()

@app.post("/stop")
def stop():
    mgr.stop(); return mgr.status()
`;
  fs.writeFileSync(appPath, code);
  return appPath;
}

export function startShardManagerProcess({
  python,
  env,
  logPath,
}) {
  const appPath = writeLocalShardManager();
  const out = fs.openSync(logPath, "a");
  const petalsPy = petalsImportable(venvPython()) ? venvPython() : python;
  const child = spawn(
    petalsPy,
    ["-m", "uvicorn", `shard_manager_app:app`, "--host", "0.0.0.0", "--port", String(SHARD_PORT)],
    {
      cwd: path.dirname(appPath),
      env: { ...process.env, ...env, PETALS_PYTHON: petalsPy, PETALS_LOG: path.join(HOME_DIR, "petals.log") },
      detached: true,
      stdio: ["ignore", out, out],
    }
  );
  child.unref();
  return { pid: child.pid, logPath, appPath };
}

export async function waitForShardRunning({ timeoutMs = 300000, statusHost } = {}) {
  const host = statusHost || process.env.BLITZWING_STATUS_HOST || "127.0.0.1";
  const petalsLog = path.join(HOME_DIR, "petals.log");
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`http://${host}:${SHARD_PORT}/status`);
      if (res.ok) {
        const body = await res.json();
        if (body.running && body.pid) return body;
        if (body.last_exit_code != null) {
          const tail = fs.existsSync(petalsLog)
            ? fs.readFileSync(petalsLog, "utf8").trim().split("\n").slice(-5).join("\n")
            : "";
          throw new Error(
            `Petals exited (code ${body.last_exit_code}). ${tail || "See " + petalsLog}`
          );
        }
      }
    } catch (err) {
      if (err instanceof Error && err.message.startsWith("Petals exited")) throw err;
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  const tail = fs.existsSync(petalsLog)
    ? fs.readFileSync(petalsLog, "utf8").trim().split("\n").slice(-5).join("\n")
    : "";
  throw new Error(
    `Timed out waiting for Petals on http://${host}:${SHARD_PORT}/status. ${tail || "See " + petalsLog}`
  );
}

export { SHARD_PORT, PETALS_PORT, venvPython };
