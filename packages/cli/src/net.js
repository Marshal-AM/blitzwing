import { execFileSync } from "node:child_process";

export async function detectPublicIp() {
  const tryUrls = [
    "http://metadata.google.internal/computeMetadata/v1/instance/network-interfaces/0/access-configs/0/external-ip",
    "http://169.254.169.254/latest/meta-data/public-ipv4",
    "https://api.ipify.org",
  ];

  for (const url of tryUrls) {
    try {
      const headers = url.includes("metadata.google.internal")
        ? { "Metadata-Flavor": "Google" }
        : {};
      const ctrl = AbortSignal.timeout(3000);
      const res = await fetch(url, { headers, signal: ctrl });
      if (!res.ok) continue;
      const text = (await res.text()).trim();
      if (/^\d+\.\d+\.\d+\.\d+$/.test(text)) return text;
    } catch {
      /* try next */
    }
  }
  return "";
}

/** Local LAN/WSL IP for shard_manager_url metadata (not Petals announce). */
export async function detectLocalIp() {
  if (process.env.BLITZWING_LOCAL_IP) {
    return process.env.BLITZWING_LOCAL_IP.trim();
  }
  try {
    const { networkInterfaces } = await import("node:os");
    const nets = networkInterfaces();
    for (const name of Object.keys(nets)) {
      for (const net of nets[name] || []) {
        if (net.family === "IPv4" && !net.internal) {
          return net.address;
        }
      }
    }
  } catch {
    /* ignore */
  }
  return "127.0.0.1";
}

/** Optional ngrok TCP tunnel for dev; production should use VM public IP or auto-relay. */
export async function discoverNgrokTcpAnnounce(petalsPort) {
  const override = process.env.BLITZWING_ANNOUNCE_MADDRS?.trim();
  if (override) return override;

  try {
    const res = await fetch("http://127.0.0.1:4040/api/tunnels", {
      signal: AbortSignal.timeout(2000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const tunnel = (data.tunnels || []).find((t) => t.proto === "tcp");
    if (!tunnel?.public_url) return null;
    const url = new URL(tunnel.public_url);
    return `/dns4/${url.hostname}/tcp/${url.port || petalsPort}`;
  } catch {
    return null;
  }
}

export function extractPeerMultiaddrFromLog(logPath, fs) {
  if (!fs.existsSync(logPath)) return null;
  const text = fs.readFileSync(logPath, "utf8");
  const line = text
    .split("\n")
    .reverse()
    .find((l) => l.includes("Running a server on"));
  if (!line) return null;
  const m = line.match(/Running a server on \['([^']+)'\]/);
  return m ? m[1] : null;
}

export function which(cmd) {
  try {
    const out = execFileSync(process.platform === "win32" ? "where" : "which", [cmd], {
      encoding: "utf8",
    });
    return out.split(/\r?\n/)[0].trim();
  } catch {
    return null;
  }
}
