# Blitzwing

Decentralized [Petals](https://github.com/bigscience-workshop/petals) inference spine with an OpenAI-compatible chat API.

## Architecture

| Component | Role |
|-----------|------|
| **Discovery** | Registry of `model → mother_url` |
| **Mother** | Orchestrator + Petals bootstrap (all layers, then carves for joiners) |
| **Contributors** | `npm i -g blitzwing` — host a slice of layers |
| **Consumers** | `examples/chat_client.py` against `/v1/chat/completions` |

Default model: `TinyLlama/TinyLlama-1.1B-Chat-v1.0` (22 layers, CPU-friendly).

## Quick start (local WSL)

```bash
# Mother stack (local-only)
wsl bash scripts/restart_local_mother.sh

# Second node on the same machine
wsl bash scripts/local_wsl_contributor_join.sh

# Chat
export BLITZWING_BASE_URL=http://127.0.0.1:8000/v1
python examples/chat_client.py -q "Say hi."
```

Full E2E (PowerShell):

```powershell
powershell -ExecutionPolicy Bypass -File scripts/run_local_e2e.ps1
```

## Remote contributors

Petals requires Linux (or WSL). Publish a public Discovery + Orchestrator + Petals TCP endpoint (see `docs/gcp-setup.md`), then:

```bash
npm i -g blitzwing
# optional: export BLITZWING_DISCOVERY_URL=https://your-discovery
blitzwing
```

## Docs

- [GCP setup](docs/gcp-setup.md)
- [Integrations](docs/integrations.md)
- [Layer rebalance](docs/rebalance.md)

## License

MIT (CLI). Petals is vendored under its upstream license — see `petals/`.
