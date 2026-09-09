import * as p from "@clack/prompts";
import color from "picocolors";
import path from "node:path";
import { DEFAULT_DISCOVERY_URL, HOME_DIR, SHARD_PORT, PETALS_PORT } from "./config.js";
import { listMothers, motherHosts, joinHost, readyHost, leaveHost } from "./api.js";
import { detectPublicIp, detectLocalIp } from "./net.js";
import {
  ensureVenvAndPetals,
  startShardManagerProcess,
  waitForShardRunning,
  syncRuntimeFiles,
  venvPython,
} from "./install.js";
import { ensureCloudflared, startQuickTunnel, stopTunnelProcess } from "./tunnel.js";
import { saveState, loadState, clearState, ensureHome } from "./state.js";
import { startContributorHeartbeatDaemon } from "./heartbeat.js";

function parseArgs(argv) {
  const out = { cmd: null, discoveryUrl: process.env.BLITZWING_DISCOVERY_URL || DEFAULT_DISCOVERY_URL };
  const rest = [...argv];
  if (rest[0] === "status" || rest[0] === "leave" || rest[0] === "help") {
    out.cmd = rest.shift();
  }
  while (rest.length) {
    const a = rest.shift();
    if (a === "--discovery-url") out.discoveryUrl = rest.shift();
    else if (a === "--help" || a === "-h") out.cmd = "help";
  }
  return out;
}

export async function run(argv) {
  const args = parseArgs(argv);
  if (args.cmd === "help") {
    printHelp();
    return;
  }
  if (args.cmd === "status") {
    await showStatus();
    return;
  }
  if (args.cmd === "leave") {
    await doLeave();
    return;
  }
  await wizard(args);
}

function printHelp() {
  console.log(`
${color.bold("blitzwing")} — join a Blitzwing mother swarm as a compute node

  blitzwing              Interactive setup wizard (recommended)
  blitzwing status       Show local contributor status
  blitzwing leave        Leave the swarm and reclaim your layers

Env:
  BLITZWING_DISCOVERY_URL      Override discovery service (default ${DEFAULT_DISCOVERY_URL})
  BLITZWING_HEDERA_ACCOUNT_ID  Prefill Hedera payout account (0.0.N)
  BLITZWING_SHARD_PORT         Local shard HTTP port (default ${SHARD_PORT})
`);
}

async function wizard(args) {
  p.intro(color.bgCyan(color.black(" blitzwing ")));
  ensureHome();

  const existing = loadState();
  const spin = p.spinner();
  spin.start("Loading network from Discovery Service…");
  let mothers;
  try {
    mothers = await listMothers(args.discoveryUrl);
  } catch (err) {
    spin.stop("Discovery failed");
    p.cancel(`Could not reach discovery at ${args.discoveryUrl}: ${err.message}`);
    process.exit(1);
  }
  spin.stop(`Found ${mothers.length} model(s)`);

  if (!mothers.length) {
    p.cancel("No mothers registered yet. Ask the operator to bootstrap a mother node.");
    process.exit(1);
  }

  let selected = mothers[0];
  if (mothers.length > 1) {
    const choice = await p.select({
      message: "Which model do you want to help serve?",
      options: mothers.map((m) => ({
        value: m.model,
        label: m.model,
        hint: m.mother_url,
      })),
    });
    if (p.isCancel(choice)) {
      p.cancel("Setup cancelled");
      process.exit(0);
    }
    selected = mothers.find((m) => m.model === choice);
  } else {
    p.log.info(`Model: ${color.cyan(selected.model)}`);
  }

  let maxLayers = selected.total_layers - 1;
  try {
    const hosts = await motherHosts(selected.mother_url);
    if (typeof hosts.max_layers_available === "number") {
      maxLayers = hosts.max_layers_available;
    }
  } catch (err) {
    p.log.warn(`Could not read live host map (${err.message}); using total_layers-1=${maxLayers}`);
  }

  if (maxLayers < 1) {
    p.cancel("No spare layers available on this swarm right now. Try again later.");
    process.exit(1);
  }

  const nonInteractive =
    process.env.BLITZWING_NONINTERACTIVE === "1" ||
    process.env.BLITZWING_YES === "1" ||
    !process.stdin.isTTY;

  let layersN;
  if (nonInteractive && process.env.BLITZWING_LAYERS) {
    layersN = Number(process.env.BLITZWING_LAYERS);
    if (!Number.isInteger(layersN) || layersN < 1 || layersN > maxLayers) {
      p.cancel(`BLITZWING_LAYERS must be an integer between 1 and ${maxLayers}`);
      process.exit(1);
    }
    p.log.info(`Layers: ${layersN} (non-interactive)`);
  } else {
    const layers = await p.text({
      message: `How many layers can this machine host? (1–${maxLayers})`,
      initialValue: String(Math.min(8, maxLayers)),
      validate(v) {
        const n = Number(v);
        if (!Number.isInteger(n) || n < 1 || n > maxLayers) {
          return `Enter an integer between 1 and ${maxLayers}`;
        }
      },
    });
    if (p.isCancel(layers)) {
      p.cancel("Setup cancelled");
      process.exit(0);
    }
    layersN = Number(layers);
  }

  const hederaPrefill =
    process.env.BLITZWING_HEDERA_ACCOUNT_ID ||
    process.env.HEDERA_ACCOUNT_ID ||
    existing?.hedera_account_id ||
    "";
  let hederaAccountId;
  if (nonInteractive && hederaPrefill) {
    hederaAccountId = String(hederaPrefill).trim();
    if (!/^0\.0\.\d+$/.test(hederaAccountId)) {
      p.cancel("BLITZWING_HEDERA_ACCOUNT_ID must look like 0.0.123456");
      process.exit(1);
    }
    p.log.info(`Hedera payouts: ${hederaAccountId} (non-interactive)`);
  } else {
    const hederaAccount = await p.text({
      message: "Hedera account ID for layer payouts (e.g. 0.0.123456)",
      initialValue: hederaPrefill,
      validate(v) {
        const s = String(v || "").trim();
        if (!/^0\.0\.\d+$/.test(s)) return "Enter a Hedera account like 0.0.123456";
      },
    });
    if (p.isCancel(hederaAccount)) {
      p.cancel("Setup cancelled");
      process.exit(0);
    }
    hederaAccountId = String(hederaAccount).trim();
  }

  if (!nonInteractive) {
    const confirm = await p.confirm({
      message: `Join ${selected.model} hosting ${layersN} layers, payouts to ${hederaAccountId}?`,
      initialValue: true,
    });
    if (p.isCancel(confirm) || !confirm) {
      p.cancel("Setup cancelled");
      process.exit(0);
    }
  } else {
    p.log.info(`Joining ${selected.model} with ${layersN} layers…`);
  }

  spin.start("Preparing Python environment + Petals");
  try {
    ensureVenvAndPetals({
      onLog: (msg) => {
        spin.message(msg);
      },
    });
    syncRuntimeFiles();
  } catch (err) {
    spin.stop("Install failed");
    p.cancel(err.message);
    process.exit(1);
  }
  const python = venvPython();
  spin.stop("Environment ready");

  spin.start("Setting up Cloudflare Quick Tunnel…");
  let tunnel;
  try {
    const cfBin = await ensureCloudflared({
      onLog: (msg) => {
        spin.message(msg);
      },
    });
    tunnel = await startQuickTunnel({
      port: SHARD_PORT,
      binary: cfBin,
      logPath: path.join(HOME_DIR, "cloudflared.log"),
    });
  } catch (err) {
    spin.stop("Tunnel failed");
    p.cancel(err.message);
    process.exit(1);
  }
  spin.stop(`Public URL ${tunnel.url}`);

  const localIp = await detectLocalIp();
  const publicIp = (await detectPublicIp()) || localIp || "tunnel";

  spin.start("Requesting layer assignment from mother…");
  let assignment;
  try {
    assignment = await joinHost(selected.mother_url, {
      model: selected.model,
      layers: layersN,
      public_ip: String(publicIp).trim(),
      shard_manager_url: tunnel.url,
      hedera_account_id: hederaAccountId,
    });
  } catch (err) {
    tunnel.stop();
    spin.stop("Join rejected");
    const max = err.body?.detail?.max_layers;
    p.cancel(`${err.message}${max != null ? ` (max available: ${max})` : ""}`);
    process.exit(1);
  }
  spin.stop(`Assigned blocks ${assignment.block_indices} (${assignment.layers_hosted} layers)`);

  const logPath = path.join(HOME_DIR, "shard_manager.log");
  spin.start("Starting local Petals server…");
  const shardEnv = {
    MODEL_NAME: selected.model,
    PUBLIC_IP: String(publicIp).trim(),
    BLOCK_INDICES: assignment.block_indices,
    INITIAL_PEERS: "",
    NEW_SWARM: "1",
    BLITZWING_HTTP_ONLY: "1",
    PETALS_PORT: String(PETALS_PORT),
    IDENTITY_PATH: path.join(HOME_DIR, "petals-identity"),
    SHARD_AUTO_START: "1",
    PETALS_USE_AUTO_RELAY: "0",
    PETALS_SKIP_REACHABILITY_CHECK: "1",
    BLITZWING_MOTHER_URL: selected.mother_url,
    MOTHER_PUBLIC_SHARD_URL: selected.mother_url,
    BLITZWING_HOST_ID: assignment.host_id,
  };
  const { pid } = startShardManagerProcess({
    python,
    logPath,
    env: shardEnv,
  });

  try {
    await waitForShardRunning({ timeoutMs: 600000, statusHost: "127.0.0.1" });
  } catch (err) {
    tunnel.stop();
    spin.stop("Petals did not become ready");
    p.cancel(`${err.message}. See ${logPath}`);
    process.exit(1);
  }
  spin.stop("Petals is serving your layers");

  spin.start("Finalizing handoff with mother…");
  try {
    await readyHost(selected.mother_url, {
      host_id: assignment.host_id,
    });
  } catch (err) {
    tunnel.stop();
    spin.stop("Handoff failed");
    p.cancel(err.message);
    process.exit(1);
  }
  spin.stop("Handoff complete");

  const state = {
    host_id: assignment.host_id,
    model: selected.model,
    mother_url: selected.mother_url,
    block_indices: assignment.block_indices,
    layers_hosted: assignment.layers_hosted,
    public_ip: String(publicIp).trim(),
    network_mode: "cloudflare",
    shard_manager_url: tunnel.url,
    tunnel_url: tunnel.url,
    tunnel_pid: tunnel.pid,
    shard_pid: pid,
    discovery_url: args.discoveryUrl,
    hedera_account_id: hederaAccountId,
    joined_at: new Date().toISOString(),
  };
  saveState(state);
  startContributorHeartbeatDaemon({
    motherUrl: state.mother_url,
    hostId: state.host_id,
  });

  p.outro(
    `${color.green("You are online.")} Hosting ${color.cyan(String(state.layers_hosted))} layers of ${color.cyan(state.model)} at ${state.block_indices}\n` +
      `Tunnel: ${color.cyan(tunnel.url)}\n` +
      `Run ${color.bold("blitzwing status")} anytime, or ${color.bold("blitzwing leave")} to exit.`
  );
}

async function showStatus() {
  const state = loadState();
  if (!state) {
    console.log("Not joined. Run blitzwing to set up this machine as a node.");
    return;
  }
  console.log(color.bold("Contributor status"));
  console.log(`  model:          ${state.model}`);
  console.log(`  host_id:        ${state.host_id}`);
  console.log(`  layers_hosted:  ${state.layers_hosted}`);
  console.log(`  block_indices:  ${state.block_indices}`);
  console.log(`  mother:         ${state.mother_url}`);
  console.log(`  tunnel:         ${state.tunnel_url || state.shard_manager_url || "—"}`);
  console.log(`  hedera:         ${state.hedera_account_id || "—"}`);
  try {
    const res = await fetch(`http://127.0.0.1:${SHARD_PORT}/status`);
    if (res.ok) {
      const st = await res.json();
      console.log(`  petals_running: ${st.running}`);
      console.log(`  petals_pid:     ${st.pid}`);
    } else {
      console.log("  petals_running: unknown");
    }
  } catch {
    console.log(`  petals_running: no (shard manager not reachable on :${SHARD_PORT})`);
  }
}

async function doLeave() {
  const state = loadState();
  if (!state) {
    p.cancel("Not joined.");
    process.exit(1);
  }
  const spin = p.spinner();
  spin.start("Leaving swarm…");
  try {
    await leaveHost(state.mother_url, { host_id: state.host_id });
  } catch (err) {
    p.log.warn(`Mother leave call failed: ${err.message}`);
  }
  try {
    await fetch(`http://127.0.0.1:${SHARD_PORT}/stop`, { method: "POST" });
  } catch {
    /* ignore */
  }
  if (state.tunnel_pid) {
    stopTunnelProcess(state.tunnel_pid);
  }
  clearState();
  spin.stop("Left swarm");
  p.outro("Your layers were reclaimed by the mother (when reachable).");
}
