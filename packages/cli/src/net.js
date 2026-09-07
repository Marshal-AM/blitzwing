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
