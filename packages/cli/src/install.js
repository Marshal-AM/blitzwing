import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { HOME_DIR, VENV_PATH, SHARD_PORT, PETALS_PORT } from "./config.js";
import { which } from "./net.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.join(__dirname, "..");
const RUNTIME_SRC = path.join(PACKAGE_ROOT, "runtime");
const RUNTIME_DEST = path.join(HOME_DIR, "runtime");

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Kill leftover contributor shard/Petals processes so a new join does not talk to a
 * stale uvicorn that still reports last_exit_code=-15 (SIGTERM from a prior leave).
 */
export function stopLocalContributorStack(extraPids = []) {
  for (const pid of extraPids) {
    if (!pid || !Number.isFinite(Number(pid))) continue;
    try {
      process.kill(Number(pid), "SIGTERM");
    } catch {
      /* already gone */
    }
  }

  if (process.platform === "win32") {
    for (const port of [SHARD_PORT, PETALS_PORT]) {
      try {
        const out = execFileSync("netstat", ["-ano"], { encoding: "utf8" });
        const re = new RegExp(`:${port}\\s+.*LISTENING\\s+(\\d+)`, "i");
        const m = out.match(re);
        if (m) {
          execFileSync("taskkill", ["/PID", m[1], "/T", "/F"], { stdio: "ignore" });
        }
      } catch {
        /* ignore */
      }
    }
    return;
  }

  try {
    execFileSync(
      "bash",
      [
        "-lc",
        [
          `fuser -k ${SHARD_PORT}/tcp ${PETALS_PORT}/tcp 2>/dev/null || true`,
          `pkill -f 'uvicorn app:app --host 0.0.0.0 --port ${SHARD_PORT}' 2>/dev/null || true`,
          `pkill -f 'petals.cli.run_server' 2>/dev/null || true`,
          "sleep 1",
        ].join("; "),
      ],
      { stdio: "ignore" }
    );
  } catch {
    /* ignore */
  }
}

function petalsLogShowsSessionStart(logPath) {
  try {
    if (!fs.existsSync(logPath)) return false;
    const text = fs.readFileSync(logPath, "utf8");
    return (
      /Starting Petals:/.test(text) ||
      /\[INFO\] Started\b/.test(text) ||
      /Running a server on/.test(text)
    );
  } catch {
    return false;
  }
}
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
    execFileSync(python, ["-c", "import petals.cli.run_server"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function uvicornImportable(python) {
  try {
    execFileSync(python, ["-c", "import uvicorn, fastapi, httpx, numpy"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function ensureShardManagerDeps(python, _pip, env, onLog) {
  if (uvicornImportable(python)) return;
  onLog?.("Installing shard manager deps (uvicorn, fastapi, httpx, numpy)...");
  execFileSync(
    python,
    ["-m", "pip", "install", "fastapi", "uvicorn[standard]", "pydantic", "httpx", "numpy"],
    { stdio: "inherit", env }
  );
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
      "Petals cannot run on native Windows (needs Linux).\n" +
        "Install Node in WSL, then:\n" +
        "  npm i -g blitzwing\n" +
        "  blitzwing"
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
  execFileSync(python, ["-m", "pip", "install", "grpcio", "grpcio-tools", "protobuf"], {
    stdio: "inherit",
    env,
  });
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
  execFileSync(
    python,
    ["-m", "pip", "install", "fastapi", "uvicorn[standard]", "pydantic", "httpx", "numpy"],
    { stdio: "inherit", env }
  );

  fs.writeFileSync(path.join(HOME_DIR, "python"), python + "\n");
  return { python, pip };
}

/**
 * Copy packaged runtime Python modules into ~/.blitzwing/runtime.
 * Contributors never need the monorepo — everything ships in the npm package.
 */
export function syncRuntimeFiles() {
  if (!fs.existsSync(RUNTIME_SRC)) {
    throw new Error(`CLI runtime missing at ${RUNTIME_SRC} — reinstall the blitzwing package`);
  }
  fs.mkdirSync(RUNTIME_DEST, { recursive: true });
  for (const name of fs.readdirSync(RUNTIME_SRC)) {
    if (!name.endsWith(".py")) continue;
    fs.copyFileSync(path.join(RUNTIME_SRC, name), path.join(RUNTIME_DEST, name));
  }
  return path.join(RUNTIME_DEST, "app.py");
}

/** @deprecated use syncRuntimeFiles */
export function writeLocalShardManager() {
  return syncRuntimeFiles();
}

export function startShardManagerProcess({ python, env, logPath }) {
  // Always clear stale listeners before binding — leave() used to stop Petals only.
  stopLocalContributorStack();
  const appPath = syncRuntimeFiles();
  fs.mkdirSync(HOME_DIR, { recursive: true });
  // Fresh logs so wait/error tails are from this session.
  try {
    fs.writeFileSync(path.join(HOME_DIR, "petals.log"), "");
  } catch {
    /* ignore */
  }
  const out = fs.openSync(logPath, "a");
  const petalsPy = petalsImportable(venvPython()) ? venvPython() : python;
  const child = spawn(
    petalsPy,
    ["-m", "uvicorn", "app:app", "--host", "0.0.0.0", "--port", String(SHARD_PORT)],
    {
      cwd: path.dirname(appPath),
      env: {
        ...process.env,
        ...env,
        PETALS_PYTHON: petalsPy,
        PETALS_LOG: path.join(HOME_DIR, "petals.log"),
        PYTHONPATH: path.dirname(appPath),
      },
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
  let sawRunning = false;

  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`http://${host}:${SHARD_PORT}/status`);
      if (res.ok) {
        const body = await res.json();
        if (body.running && body.pid) {
          sawRunning = true;
          return body;
        }
        if (body.last_exit_code != null) {
          // A prior leave/stop leaves uvicorn up with last_exit_code=-15. Ignore that
          // until this session's Petals has actually started (or we already saw running).
          const sessionStarted = petalsLogShowsSessionStart(petalsLog);
          if (sawRunning || sessionStarted) {
            const tail = fs.existsSync(petalsLog)
              ? fs.readFileSync(petalsLog, "utf8").trim().split("\n").slice(-8).join("\n")
              : "";
            throw new Error(
              `Petals exited (code ${body.last_exit_code}). ${tail || "See " + petalsLog}`
            );
          }
        }
      }
    } catch (err) {
      if (err instanceof Error && err.message.startsWith("Petals exited")) throw err;
    }
    await sleep(2000);
  }
  const tail = fs.existsSync(petalsLog)
    ? fs.readFileSync(petalsLog, "utf8").trim().split("\n").slice(-8).join("\n")
    : "";
  throw new Error(
    `Timed out waiting for Petals on http://${host}:${SHARD_PORT}/status. ${tail || "See " + petalsLog}`
  );
}

export { SHARD_PORT, PETALS_PORT, venvPython, RUNTIME_DEST };
