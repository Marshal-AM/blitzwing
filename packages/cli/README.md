# blitzwing

**Join a decentralized LLM inference swarm as a compute contributor — and earn HBAR.**
One command. No repo clone. No port forwarding. No GPU required.

`blitzwing` is the contributor client for the [Blitzwing](https://github.com/Marshal-AM/blitzwing)
network: an OpenAI-compatible large-language-model inference system where a model is split
layer-by-layer across many ordinary machines. You host a slice of the model's layers, and you're paid
**HBAR on Hedera** proportional to how many layers you host — every time a request routes through you.

Because the default model runs on CPU and the CLI opens a free outbound tunnel for you, a plain laptop
behind a home router can join and start earning in minutes.

---

## How you earn

When you join, you tell the wizard how many layers your machine can host and give it your Hedera
account ID. From then on, your machine computes its slice of the model whenever a request passes
through it. For each paid request, you receive:

```
your payout = layers_you_host × per-layer price
```

With the network's defaults, each layer is worth **0.1 HBAR**, so hosting 8 layers earns **0.8 HBAR**
per request you help serve. Payouts land in your Hedera account within seconds, with a
consensus-timestamped audit record you can verify on HashScan. You provide only a **public account ID**
— your private keys never leave your machine.

For the full picture of how the network works, see the
[main Blitzwing README](https://github.com/Marshal-AM/blitzwing#readme).

---

## Prerequisites

| Requirement | Notes |
|-------------|-------|
| **Node.js ≥ 18** | Runs this CLI. |
| **Python 3.10 or 3.11** | Runs the local inference runtime. **Python 3.12+ is not supported** — the CLI will reject it and tell you how to pin 3.11 with `uv`. |
| **Linux or WSL** | The compute engine needs Linux. On Windows, run everything inside **WSL** — native Windows is not supported. |
| **A Hedera testnet account** | Your `0.0.N` account ID for payouts. Create one at the Hedera Developer Portal and fund it from the faucet. |

---

## Install

```bash
npm i -g blitzwing
```

**Windows:** open a **WSL** shell, install Node.js inside WSL, then run `npm i -g blitzwing` there.
The compute runtime cannot run on native Windows.

If your default Python is 3.12 or newer, pin 3.11 before joining:

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
source "$HOME/.local/bin/env"
uv python install 3.11
export BLITZWING_PYTHON="$(uv python find 3.11)"
```

---

## Usage

```bash
blitzwing            # interactive setup wizard (recommended) — discover, join, serve, earn
blitzwing status     # show this machine's contributor status
blitzwing leave      # leave the swarm; your layers are reclaimed
blitzwing help       # usage (also: blitzwing --help, blitzwing -h)
```

| Command | What it does |
|---------|--------------|
| `blitzwing` | Runs the interactive wizard: discovers models, asks which model and how many layers to host, asks for your Hedera account, installs the runtime on first run, opens a free Cloudflare tunnel, joins the swarm, and starts heartbeating. |
| `blitzwing status` | Prints your saved node state (model, host id, layers hosted, block range, mother URL, tunnel URL, Hedera account, ENS name) plus the live running state of your local engine. |
| `blitzwing leave` | Tells the mother you're leaving, stops your local engine and tunnel, and clears local state. Your layers are reclaimed by the swarm. |
| `blitzwing help` | Prints help. |

| Flag | Effect |
|------|--------|
| `--discovery-url <url>` | Override the Discovery Service URL for this run. |
| `--help`, `-h` | Show help. |

---

## What the wizard does

```
1. Discover models from the Discovery Service (no mother URL to type)
2. Pick a model and choose how many layers to host (1 … max available)
3. Enter your Hedera account ID (0.0.N) for payouts
4. Install the local inference runtime (first run only — creates a venv)
5. Open a free Cloudflare Quick Tunnel (no account, no token)
6. Request a layer assignment from the mother and start serving
7. Finalize the handoff; start a background heartbeat daemon
8. ✅ You're online and earning — your block range and ENS name are printed
```

You never clone the repository — the Python runtime ships inside this npm package and is installed into
`~/.blitzwing/` on first run.

---

## Environment variables

All optional — the wizard prompts for what it needs. Set these to prefill answers or run
non-interactively.

| Variable | Purpose | Default |
|----------|---------|---------|
| `BLITZWING_DISCOVERY_URL` | Override the Discovery Service URL. | baked-in network default |
| `BLITZWING_HEDERA_ACCOUNT_ID` | Prefill your Hedera payout account (`0.0.N`). Falls back to `HEDERA_ACCOUNT_ID`. | — |
| `BLITZWING_LAYERS` | Layer count to host (for non-interactive joins). | prompted |
| `BLITZWING_NONINTERACTIVE` / `BLITZWING_YES` | Run without prompts (also auto-enabled when stdin isn't a TTY). | off |
| `BLITZWING_SHARD_PORT` | Local shard-manager HTTP port. | `8001` (Linux) / `8011` (Windows+WSL) |
| `BLITZWING_HOME` | State/logs/venv directory. | `~/.blitzwing` |
| `BLITZWING_PYTHON` | Explicit Python 3.10/3.11 interpreter path. | auto-detected |

### Non-interactive / CI join

```bash
export BLITZWING_HEDERA_ACCOUNT_ID=0.0.123456
export BLITZWING_LAYERS=8
export BLITZWING_NONINTERACTIVE=1
blitzwing
blitzwing status
```

---

## Files & state

Everything the CLI creates lives under `~/.blitzwing/` (or `$BLITZWING_HOME`):

| Path | Contents |
|------|----------|
| `contributor.json` | Your saved node state (model, host id, block range, mother URL, tunnel, Hedera account, ENS name). |
| `venv/` | The Python virtual environment for the inference runtime. |
| `runtime/` | The bundled runtime copied from this package. |
| `*.log` (e.g. `shard_manager.log`, `cloudflared.log`) | Logs for the local engine and tunnel. |
| identity file | Your persistent swarm peer identity (kept across restarts). |

---

## Running on a public cloud VM

For an always-on contributor, a small Linux VM with a public IP is ideal:

1. Open inbound TCP **31337** (swarm P2P) and **8001** (shard manager).
2. Install Node 18+ and Python 3.11.
3. `npm i -g blitzwing`
4. `blitzwing` → choose the **public IP / cloud VM** option and enter the VM's public IPv4.
5. Provide your Hedera account for payouts.

See [`docs/contributor-setup.md`](https://github.com/Marshal-AM/blitzwing/blob/main/docs/contributor-setup.md)
and [`docs/gcp-setup.md`](https://github.com/Marshal-AM/blitzwing/blob/main/docs/gcp-setup.md).

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| *"Could not reach discovery"* | The Discovery Service is unreachable. Check your connection, or set `BLITZWING_DISCOVERY_URL` / `--discovery-url` to a reachable discovery endpoint. |
| *"No mothers registered"* | No swarm is live for any model yet. Ask the operator to bootstrap a mother, then retry. |
| *Join rejected — max layers* | You asked for more layers than are currently free. Retry with a smaller number; the error reports the max available. |
| *Python version error* | You're on Python 3.12+. Install and pin 3.11 with `uv` (see [Install](#install)) and set `BLITZWING_PYTHON`. |
| *"cannot run on native Windows"* | Run inside WSL — the compute engine needs Linux. |
| *Engine didn't become ready* | Check the logs in `~/.blitzwing/` (`shard_manager.log` and the engine log). First-run model download can take time on a slow link. |
| *Want a clean restart* | `blitzwing leave`, then `blitzwing` again. |

---

## License

MIT.

- Homepage & full docs: https://github.com/Marshal-AM/blitzwing
- How the network works (architecture, Hedera, ENS): [main README](https://github.com/Marshal-AM/blitzwing#readme)
