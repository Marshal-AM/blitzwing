import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { HOME_DIR } from "./config.js";
import { which } from "./net.js";

const BIN_DIR = path.join(HOME_DIR, "bin");
const URL_RE = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i;

function platformAsset() {
  const plat = process.platform;
  const arch = process.arch;
  if (plat === "linux" && arch === "x64") {
    return { name: "cloudflared-linux-amd64", archive: false };
  }
  if (plat === "linux" && (arch === "arm64" || arch === "aarch64")) {
    return { name: "cloudflared-linux-arm64", archive: false };
  }
  if (plat === "darwin" && arch === "arm64") {
    return { name: "cloudflared-darwin-arm64.tgz", archive: true };
  }
  if (plat === "darwin" && arch === "x64") {
    return { name: "cloudflared-darwin-amd64.tgz", archive: true };
  }
  if (plat === "win32" && arch === "x64") {
    return { name: "cloudflared-windows-amd64.exe", archive: false, exe: true };
  }
  throw new Error(
    `Unsupported platform for cloudflared auto-install: ${plat}/${arch}. Install cloudflared manually and retry.`
  );
}

function localBinaryPath() {
  const exe = process.platform === "win32" ? "cloudflared.exe" : "cloudflared";
  return path.join(BIN_DIR, exe);
}

/**
 * Resolve cloudflared binary: PATH first, then ~/.blitzwing/bin (download if missing).
 * @param {{ onLog?: (msg: string) => void }} [opts]
 */
export async function ensureCloudflared({ onLog } = {}) {
  const onPath = which("cloudflared");
  if (onPath) return onPath;

  const dest = localBinaryPath();
  if (fs.existsSync(dest)) {
    try {
      fs.chmodSync(dest, 0o755);
    } catch {
      /* ignore */
    }
    return dest;
  }

  const asset = platformAsset();
  const url = `https://github.com/cloudflare/cloudflared/releases/latest/download/${asset.name}`;
  onLog?.(`Downloading cloudflared (${asset.name})…`);
  fs.mkdirSync(BIN_DIR, { recursive: true });

  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok || !res.body) {
    throw new Error(`Failed to download cloudflared: HTTP ${res.status} from ${url}`);
  }

  if (asset.archive) {
    const tgzPath = path.join(BIN_DIR, asset.name);
    await pipeline(Readable.fromWeb(res.body), createWriteStream(tgzPath));
    execFileSync("tar", ["-xzf", tgzPath, "-C", BIN_DIR], { stdio: "ignore" });
    try {
      fs.unlinkSync(tgzPath);
    } catch {
      /* ignore */
    }
    // tgz extracts a binary named cloudflared
    const extracted = path.join(BIN_DIR, "cloudflared");
    if (!fs.existsSync(extracted) && fs.existsSync(dest)) {
      /* already named correctly */
    } else if (fs.existsSync(extracted) && extracted !== dest) {
      fs.renameSync(extracted, dest);
    }
  } else {
    await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
  }

  try {
    fs.chmodSync(dest, 0o755);
  } catch {
    /* windows */
  }
  if (!fs.existsSync(dest)) {
    throw new Error(`cloudflared download finished but binary missing at ${dest}`);
  }
  onLog?.(`cloudflared ready at ${dest}`);
  return dest;
}

/**
 * Kill a process (and its group on Unix).
 * @param {number} pid
 */
export function stopTunnelProcess(pid) {
  if (!pid || !Number.isFinite(pid)) return;
  try {
    if (process.platform === "win32") {
      execFileSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
    } else {
      try {
        process.kill(-pid, "SIGTERM");
      } catch {
        process.kill(pid, "SIGTERM");
      }
      setTimeout(() => {
        try {
          process.kill(-pid, "SIGKILL");
        } catch {
          try {
            process.kill(pid, "SIGKILL");
          } catch {
            /* already gone */
          }
        }
      }, 2000).unref?.();
    }
  } catch {
    /* already gone */
  }
}

/**
 * Start a Cloudflare Quick Tunnel to http://127.0.0.1:port (no account/token).
 * @param {{ port: number, binary?: string, logPath?: string, timeoutMs?: number }} opts
 * @returns {Promise<{ url: string, pid: number, stop: () => void }>}
 */
export async function startQuickTunnel({
  port,
  binary,
  logPath = path.join(HOME_DIR, "cloudflared.log"),
  timeoutMs = 90_000,
}) {
  const bin = binary || (await ensureCloudflared());
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  const logFd = fs.openSync(logPath, "a");

  const child = spawn(
    bin,
    ["tunnel", "--url", `http://127.0.0.1:${port}`, "--no-autoupdate"],
    {
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    }
  );

  let settled = false;
  let buffer = "";

  const appendLog = (chunk) => {
    const text = chunk.toString();
    buffer += text;
    try {
      fs.writeSync(logFd, text);
    } catch {
      /* ignore */
    }
  };

  child.stdout?.on("data", appendLog);
  child.stderr?.on("data", appendLog);

  const stop = () => {
    stopTunnelProcess(child.pid);
    try {
      fs.closeSync(logFd);
    } catch {
      /* ignore */
    }
  };

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      stop();
      reject(
        new Error(
          `Timed out waiting for Cloudflare Quick Tunnel URL. See ${logPath}`
        )
      );
    }, timeoutMs);

    const tryMatch = () => {
      const m = buffer.match(URL_RE);
      if (!m || settled) return;
      settled = true;
      clearTimeout(timer);
      if (process.platform !== "win32") {
        child.unref();
      }
      resolve({
        url: m[0].replace(/\/$/, ""),
        pid: child.pid,
        stop,
      });
    };

    child.stdout?.on("data", tryMatch);
    child.stderr?.on("data", tryMatch);

    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });

    child.on("exit", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(
        new Error(
          `cloudflared exited early (code ${code}). See ${logPath}`
        )
      );
    });
  });
}
