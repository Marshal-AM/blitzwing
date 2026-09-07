import * as p from "@clack/prompts";
import color from "picocolors";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { DEFAULT_DISCOVERY_URL, HOME_DIR, SHARD_PORT, PETALS_PORT } from "./config.js";
import { listMothers, motherHosts, joinHost, readyHost, leaveHost } from "./api.js";
import { detectPublicIp } from "./net.js";
import {
  ensureVenvAndPetals,
  startShardManagerProcess,
  waitForShardRunning,
  venvPython,
} from "./install.js";
import { saveState, loadState, clearState, ensureHome } from "./state.js";

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
  BLITZWING_DISCOVERY_URL   Override discovery service (default ${DEFAULT_DISCOVERY_URL})
`);
}

async function wizard(args) {
  p.intro(color.bgCyan(color.black(" blitzwing ")));
  ensureHome();

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
  const layersN = Number(layers);

  const detected = await detectPublicIp();
  const publicIp = await p.text({
    message: "Public IP for this machine (other peers must reach you)",
    initialValue: detected || "",
    validate(v) {
      if (!v || !v.trim()) return "Public IP is required";
    },
  });
  if (p.isCancel(publicIp)) {
    p.cancel("Setup cancelled");
    process.exit(0);
  }

  const confirm = await p.confirm({
    message: `Join ${selected.model} hosting ${layersN} layers from ${String(publicIp).trim()}?`,
    initialValue: true,
  });
  if (p.isCancel(confirm) || !confirm) {
    p.cancel("Setup cancelled");
    process.exit(0);
  }

  spin.start("Preparing Python environment + Petals");
  try {
    ensureVenvAndPetals({
      onLog: (msg) => {
        spin.message(msg);
      },
    });
  } catch (err) {
    spin.stop("Install failed");
    p.cancel(err.message);
    process.exit(1);
  }
  const python = venvPython();
  spin.stop("Environment ready");

  const shardManagerUrl = `http://${String(publicIp).trim()}:${SHARD_PORT}`;

  spin.start("Requesting layer assignment from mother…");
  let assignment;
  try {
    assignment = await joinHost(selected.mother_url, {
      model: selected.model,
      layers: layersN,
      public_ip: String(publicIp).trim(),
      shard_manager_url: shardManagerUrl,
    });
  } catch (err) {
    spin.stop("Join rejected");
    const max = err.body?.detail?.max_layers;
    p.cancel(`${err.message}${max != null ? ` (max available: ${max})` : ""}`);
    process.exit(1);
  }
  spin.stop(`Assigned blocks ${assignment.block_indices} (${assignment.layers_hosted} layers)`);

  const logPath = path.join(HOME_DIR, "shard_manager.log");
  spin.start("Starting local Petals server…");
  const { pid } = startShardManagerProcess({
    python,
    logPath,
    env: {
      MODEL_NAME: selected.model,
      PUBLIC_IP: String(publicIp).trim(),
      BLOCK_INDICES: assignment.block_indices,
      INITIAL_PEERS: (assignment.initial_peers || []).join(","),
      PETALS_PORT: String(PETALS_PORT),
      IDENTITY_PATH: path.join(HOME_DIR, "petals-identity"),
      SHARD_AUTO_START: "1",
    },
  });

  try {
    await waitForShardRunning({ timeoutMs: 600000, statusHost: String(publicIp).trim() });
  } catch (err) {
    spin.stop("Petals did not become ready");
    p.cancel(`${err.message}. See ${logPath}`);
    process.exit(1);
  }
  spin.stop("Petals is serving your layers");

  spin.start("Finalizing handoff with mother…");
  try {
    await readyHost(selected.mother_url, { host_id: assignment.host_id });
  } catch (err) {
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
    shard_manager_url: shardManagerUrl,
    shard_pid: pid,
    discovery_url: args.discoveryUrl,
    joined_at: new Date().toISOString(),
  };
  saveState(state);
  startHeartbeatDaemon(state);

  p.outro(
    `${color.green("You are online.")} Hosting ${color.cyan(String(state.layers_hosted))} layers of ${color.cyan(state.model)} at ${state.block_indices}\n` +
      `Run ${color.bold("blitzwing status")} anytime, or ${color.bold("blitzwing leave")} to exit.`
  );
}

function startHeartbeatDaemon(state) {
  const hbPath = path.join(HOME_DIR, "heartbeat.mjs");
  fs.writeFileSync(
    hbPath,
    `const mother = ${JSON.stringify(state.mother_url)};
const hostId = ${JSON.stringify(state.host_id)};
async function beat() {
  try {
    await fetch(mother.replace(/\\/$/, "") + "/v1/hosts/heartbeat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ host_id: hostId }),
    });
  } catch {}
}
setInterval(beat, 60000);
beat();
`
  );
  const child = spawn(process.execPath, [hbPath], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
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
  console.log(`  public_ip:      ${state.public_ip}`);
  try {
    const statusHost = state.public_ip || "127.0.0.1";
    const res = await fetch(`http://${statusHost}:${SHARD_PORT}/status`);
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
    const statusHost = state.public_ip || "127.0.0.1";
    await fetch(`http://${statusHost}:${SHARD_PORT}/stop`, { method: "POST" });
  } catch {
    /* ignore */
  }
  clearState();
  spin.stop("Left swarm");
  p.outro("Your layers were reclaimed by the mother (when reachable).");
}
