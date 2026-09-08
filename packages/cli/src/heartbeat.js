import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { heartbeatHost } from "./api.js";
import { HOME_DIR } from "./config.js";

/** Must be well below mother HEARTBEAT_TTL_SECONDS (default 60). */
export const DEFAULT_HEARTBEAT_INTERVAL_MS = 20_000;

/**
 * Start a detached background process that heartbeats the mother orchestrator.
 * @param {{ motherUrl: string, hostId: string, intervalMs?: number }} opts
 */
export function startContributorHeartbeatDaemon({
  motherUrl,
  hostId,
  intervalMs = DEFAULT_HEARTBEAT_INTERVAL_MS,
}) {
  const hbPath = path.join(HOME_DIR, "heartbeat.mjs");
  fs.mkdirSync(HOME_DIR, { recursive: true });
  fs.writeFileSync(
    hbPath,
    `const mother = ${JSON.stringify(motherUrl)};
const hostId = ${JSON.stringify(hostId)};
const intervalMs = ${intervalMs};
async function beat() {
  try {
    await fetch(mother.replace(/\\/$/, "") + "/v1/hosts/heartbeat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "ngrok-skip-browser-warning": "true",
      },
      body: JSON.stringify({
        host_id: hostId,
        block_indices: process.env.BLOCK_INDICES || undefined,
      }),
    });
  } catch {}
}
setInterval(beat, intervalMs);
beat();
`
  );
  const child = spawn(process.execPath, [hbPath], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
}

/** In-process heartbeat loop (for tests or long-running CLI). */
export async function startContributorHeartbeatLoop({
  motherUrl,
  hostId,
  intervalMs = DEFAULT_HEARTBEAT_INTERVAL_MS,
}) {
  async function beat() {
    try {
      await heartbeatHost(motherUrl, { host_id: hostId });
    } catch {
      /* mother may be briefly unavailable */
    }
  }
  setInterval(beat, intervalMs);
  await beat();
}
