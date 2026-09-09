#!/usr/bin/env bash
# Restart mother Petals at current registry range (0:18) without resetting orchestrator.
set -euo pipefail
ROOT="${HOME}/blitzwing"
cd "$ROOT"
set -a
# shellcheck disable=SC1091
source "$ROOT/.env"
set +a
PUBLIC_IP="${PUBLIC_IP:-$(curl -s --max-time 10 ifconfig.me)}"
PY="${HOME}/venv/bin/python"
export PATH="${HOME}/.local/bin:${PATH}" PYTHONPATH="$ROOT"

BLOCKS="${1:-0:18}"
echo "Restarting mother Petals blocks=${BLOCKS}"

pkill -f 'uvicorn shard_manager.app' || true
pkill -f 'petals.cli.run_server' || true
sleep 2

export MODEL_NAME="${MODEL_NAME:-bigscience/bloom-560m}"
export PUBLIC_IP
export BLOCK_INDICES="$BLOCKS"
export NEW_SWARM=1
export IDENTITY_PATH="${HOME}/.blitzwing/petals-identity-mother"
export PETALS_PORT=31337
export PETALS_DEVICE=cpu
export PETALS_QUANT_TYPE=none
export PETALS_PYTHON="$PY"
export PETALS_SERVER_LOG="${HOME}/blitzwing-logs/shard_manager.log"
export SHARD_AUTO_START=1
export ANNOUNCE_MADDRS="/ip4/${PUBLIC_IP}/tcp/31337"
# Clear stale self-peers so start uses --new_swarm
unset INITIAL_PEERS || true

: > "${HOME}/blitzwing-logs/shard_manager.log"
nohup "$PY" -m uvicorn shard_manager.app:app --host 0.0.0.0 --port 8001 \
  > "${HOME}/blitzwing-logs/shard_manager.log" 2>&1 &

for i in $(seq 1 120); do
  if curl -sf http://127.0.0.1:8001/status | grep -q '"running":true'; then
    echo "up after $((i*5))s"
    break
  fi
  sleep 5
done
curl -sS http://127.0.0.1:8001/status; echo
# wait for "Started" / Running
for i in $(seq 1 60); do
  if grep -q "Running a server on" "${HOME}/blitzwing-logs/shard_manager.log"; then
    grep "Running a server on" "${HOME}/blitzwing-logs/shard_manager.log" | tail -n1
    break
  fi
  sleep 5
done
# Gateway may not be up yet during clean restart — probe orch registry instead.
curl -sS -m 5 http://127.0.0.1:8002/v1/hosts 2>/dev/null \
  || curl -sS -m 5 http://127.0.0.1:8000/v1/hosts 2>/dev/null \
  || true
echo
echo MOTHER_PETALS_OK
