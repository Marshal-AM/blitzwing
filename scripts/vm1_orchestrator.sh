#!/usr/bin/env bash
# Start the OpenAI-compatible orchestrator on VM1 (second process alongside Petals).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

cd "${REPO_ROOT}"

if [[ -f "${REPO_ROOT}/orchestrator/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "${REPO_ROOT}/orchestrator/.env"
  set +a
fi

export MODEL_NAME="${MODEL_NAME:-TinyLlama/TinyLlama-1.1B-Chat-v1.0}"
export INITIAL_PEERS="${INITIAL_PEERS:?Set INITIAL_PEERS to the VM1 Petals bootstrap multiaddr}"
export API_HOST="${API_HOST:-0.0.0.0}"
export API_PORT="${API_PORT:-8000}"
export PYTHONPATH="${REPO_ROOT}${PYTHONPATH:+:${PYTHONPATH}}"

echo "Starting orchestrator on ${API_HOST}:${API_PORT}"
echo "  model=${MODEL_NAME}"
echo "  initial_peers=${INITIAL_PEERS}"

exec python -m uvicorn orchestrator.app.main:app \
  --host "${API_HOST}" \
  --port "${API_PORT}"
