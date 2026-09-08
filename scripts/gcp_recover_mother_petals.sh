#!/usr/bin/env bash
# Recover mother Petals after a bad contributor handoff (full 0:22 + new orchestrator registry).
set -euo pipefail
ROOT="${HOME}/blitzwing"
cd "$ROOT"
set -a
# shellcheck disable=SC1091
source "$ROOT/.env"
set +a
PUBLIC_IP="${PUBLIC_IP:-$(curl -s --max-time 10 ifconfig.me)}"
PY="${HOME}/venv/bin/python"
export PATH="${HOME}/.local/bin:${PATH}"
export PYTHONPATH="$ROOT"
mkdir -p "${HOME}/.blitzwing" "${HOME}/blitzwing-logs"

echo "== stop shard/orch/petals =="
pkill -f 'uvicorn shard_manager.app' || true
pkill -f 'petals.cli.run_server' || true
pkill -f 'uvicorn orchestrator.app.main' || true
sleep 3

export MODEL_NAME=TinyLlama/TinyLlama-1.1B-Chat-v1.0
export PUBLIC_IP
export BLOCK_INDICES=0:22
export NEW_SWARM=1
export IDENTITY_PATH="${HOME}/.blitzwing/petals-identity-mother"
export PETALS_PORT=31337
export PETALS_DEVICE=cpu
export PETALS_QUANT_TYPE=none
export PETALS_PYTHON="$PY"
export SHARD_AUTO_START=1
export ANNOUNCE_MADDRS="/ip4/${PUBLIC_IP}/tcp/31337"

: > "${HOME}/blitzwing-logs/shard_manager.log"
nohup "$PY" -m uvicorn shard_manager.app:app --host 0.0.0.0 --port 8001 \
  > "${HOME}/blitzwing-logs/shard_manager.log" 2>&1 &
echo "shard_pid=$!"

echo "waiting for Petals running…"
for i in $(seq 1 120); do
  if curl -sf http://127.0.0.1:8001/status | grep -q '"running":true'; then
    echo "running after $((i*5))s"
    break
  fi
  sleep 5
done
curl -sS http://127.0.0.1:8001/status
echo

PEER_LINE="$(grep -Eo '/ip4/[^ ]+/tcp/[0-9]+/p2p/[A-Za-z0-9]+' "${HOME}/blitzwing-logs/shard_manager.log" | tail -n1 || true)"
echo "PEER_LINE=${PEER_LINE}"
[[ -n "$PEER_LINE" ]] || { echo PEER_DETECT_FAILED; tail -n 80 "${HOME}/blitzwing-logs/shard_manager.log"; exit 1; }
BOOTSTRAP="$PEER_LINE"
if grep -q '^INITIAL_PEERS=' "$ROOT/.env"; then
  sed -i "s|^INITIAL_PEERS=.*|INITIAL_PEERS=${BOOTSTRAP}|" "$ROOT/.env"
else
  echo "INITIAL_PEERS=${BOOTSTRAP}" >> "$ROOT/.env"
fi

set -a
# shellcheck disable=SC1091
source "$ROOT/.env"
set +a
export PYTHONPATH="$ROOT"
export INITIAL_PEERS="${BOOTSTRAP}"
export ANNOUNCE_PEERS="${BOOTSTRAP}"
export LOAD_AT_STARTUP=1
export API_PORT=8002

nohup "$PY" -m uvicorn orchestrator.app.main:app --host 127.0.0.1 --port 8002 \
  > "${HOME}/blitzwing-logs/orchestrator.log" 2>&1 &
for i in $(seq 1 60); do
  curl -sf http://127.0.0.1:8002/health && break
  sleep 2
done
echo
curl -sS http://127.0.0.1:8000/health; echo
curl -sS http://127.0.0.1:8000/v1/hosts; echo
echo "RECOVER_OK public=${PUBLIC_IP} bootstrap=${BOOTSTRAP}"
