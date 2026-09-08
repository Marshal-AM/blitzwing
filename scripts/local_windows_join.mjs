/**
 * Non-interactive local Windows contributor join (same PC as WSL mother).
 * Usage (from repo root):
 *   set BLITZWING_DISCOVERY_URL=http://127.0.0.1:9000
 *   set WIN_HOST_IP=172.x.x.1
 *   node scripts/local_windows_join.mjs
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  joinHost,
  listMothers,
  readyHost,
} from "../packages/cli/src/api.js";
import {
  ensureVenvAndPetals,
  startShardManagerProcess,
  waitForShardRunning,
  venvPython,
} from "../packages/cli/src/install.js";
import { HOME_DIR, PETALS_PORT, SHARD_PORT } from "../packages/cli/src/config.js";
import { saveState } from "../packages/cli/src/state.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const discoveryUrl = process.env.BLITZWING_DISCOVERY_URL || "http://127.0.0.1:9000";
const layers = Number(process.env.BLITZWING_LAYERS || "8");
const winHostIp = process.env.WIN_HOST_IP;

if (!winHostIp) {
  console.error("Set WIN_HOST_IP to the Windows host IP as seen from WSL (ip route default gateway).");
  process.exit(1);
}

console.log(`Discovery: ${discoveryUrl}`);
console.log(`Windows host IP (for mother reachability): ${winHostIp}`);
console.log(`Layers: ${layers}`);

const mothers = await listMothers(discoveryUrl);
if (!mothers.length) {
  console.error("No mothers in discovery");
  process.exit(1);
}
const selected = mothers[0];
console.log(`Mother: ${selected.mother_url}`);

console.log("Installing Petals venv if needed…");
const { python: venvPy } = ensureVenvAndPetals({ onLog: (m) => console.log(m) });
// Always run shard manager + Petals from the venv (BLITZWING_PYTHON may be a bare "python" on PATH).
const py = venvPy;

const hederaAccountId = process.env.BLITZWING_HEDERA_ACCOUNT_ID || process.env.HEDERA_ACCOUNT_ID;
if (!hederaAccountId || !/^0\.0\.\d+$/.test(hederaAccountId)) {
  console.error("Set BLITZWING_HEDERA_ACCOUNT_ID (or HEDERA_ACCOUNT_ID) to a Hedera account like 0.0.123456");
  process.exit(1);
}

const shardManagerUrl = `http://${winHostIp}:${SHARD_PORT}`;
console.log("Joining swarm…");
const assignment = await joinHost(selected.mother_url, {
  model: selected.model,
  layers,
  public_ip: winHostIp,
  shard_manager_url: shardManagerUrl,
  hedera_account_id: hederaAccountId,
});
console.log(`Assigned ${assignment.block_indices} host_id=${assignment.host_id}`);

const logPath = path.join(HOME_DIR, "shard_manager.log");
const { pid } = startShardManagerProcess({
  python: py,
  logPath,
  env: {
    MODEL_NAME: selected.model,
    PUBLIC_IP: winHostIp,
    BLOCK_INDICES: assignment.block_indices,
    INITIAL_PEERS: (assignment.initial_peers || []).join(","),
    PETALS_PORT: String(PETALS_PORT),
    IDENTITY_PATH: path.join(HOME_DIR, "petals-identity"),
    SHARD_AUTO_START: "1",
  },
});

console.log(`Shard manager pid=${pid}, waiting for Petals…`);
await waitForShardRunning({ timeoutMs: 600000, statusHost: winHostIp });
console.log("Petals running, sending ready…");
await readyHost(selected.mother_url, { host_id: assignment.host_id });

saveState({
  host_id: assignment.host_id,
  model: selected.model,
  mother_url: selected.mother_url,
  block_indices: assignment.block_indices,
  layers_hosted: assignment.layers_hosted,
  public_ip: winHostIp,
  shard_manager_url: shardManagerUrl,
  shard_pid: pid,
  discovery_url: discoveryUrl,
  hedera_account_id: hederaAccountId,
  joined_at: new Date().toISOString(),
});

console.log("JOIN_OK", assignment.block_indices);
