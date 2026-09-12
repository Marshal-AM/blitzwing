#!/usr/bin/env bash
# Full mother restart with SmolLM2-360M (legacy filename kept for existing callers).
set -euo pipefail

ROOT="${HOME}/blitzwing"
cd "$ROOT"

echo "=== Stopping all services ==="
# Use specific process names to avoid killing SSH
for proc in 'uvicorn shard_manager' 'uvicorn orchestrator' 'petals.cli.run_server' 'x402-gateway/index.ts' 'x402-facilitator/index.ts'; do
    pkill -9 -f "$proc" 2>/dev/null || true
done
sleep 3

echo "=== Clearing old state ==="
rm -f ~/.blitzwing/swarm_registry.json

echo "=== Setting up environment ==="
set -a
source "$ROOT/.env"
set +a

export MODEL_NAME="${MODEL_NAME:-HuggingFaceTB/SmolLM2-360M-Instruct}"
export TOTAL_LAYERS="${TOTAL_LAYERS:-32}"
export BLOCK_INDICES="0:${TOTAL_LAYERS}"

echo "MODEL_NAME=$MODEL_NAME"
echo "TOTAL_LAYERS=$TOTAL_LAYERS"
echo "BLOCK_INDICES=$BLOCK_INDICES"

echo "=== Starting shard manager with SmolLM2 ==="
bash scripts/gcp_restart_mother_blocks.sh "$BLOCK_INDICES"

echo "=== Starting orchestrator and gateway ==="
bash scripts/gcp_restart_orchestrator.sh

echo "=== FULL_RESTART_DONE ==="
