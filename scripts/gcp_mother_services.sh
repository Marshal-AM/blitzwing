#!/usr/bin/env bash
# Start Blitzwing mother payment + inference services (assumes Petals/venv already installed).
# Uses packages/x402-facilitator — no external product repos.
set -euo pipefail

ROOT="${HOME}/blitzwing"
cd "$ROOT"
git fetch origin
git reset --hard origin/main

# shellcheck disable=SC1091
set -a
source "$ROOT/.env"
set +a

PUBLIC_IP="${PUBLIC_IP:-$(curl -s --max-time 10 ifconfig.me)}"
PY="${HOME}/venv/bin/python"
export PATH="${HOME}/.local/bin:${PATH}"
mkdir -p "${HOME}/blitzwing-logs"

# --- facilitator :8791 ---
cd "$ROOT/packages/x402-facilitator"
npm install
pkill -f 'packages/x402-facilitator' || true
pkill -f 'x402-facilitator/index' || true
sleep 1
nohup npx tsx index.ts > "${HOME}/blitzwing-logs/facilitator.log" 2>&1 &
for i in $(seq 1 60); do curl -sf http://127.0.0.1:8791/health && break; sleep 2; done
curl -sf http://127.0.0.1:8791/health || { echo FACILITATOR_FAILED; tail -n 80 "${HOME}/blitzwing-logs/facilitator.log"; exit 1; }
echo

# --- shard manager (if not already) ---
export PYTHONPATH="$ROOT"
export BLOCK_INDICES="0:${TOTAL_LAYERS:-22}"
export NEW_SWARM="${NEW_SWARM:-0}"
export IDENTITY_PATH="${HOME}/.blitzwing/petals-identity-mother"
export PETALS_PORT=31337
export PETALS_DEVICE=cpu
export PETALS_QUANT_TYPE=none
export PETALS_PYTHON="$PY"
export SHARD_AUTO_START=1
export ANNOUNCE_MADDRS="/ip4/${PUBLIC_IP}/tcp/31337"
export PUBLIC_IP

if ! curl -sf http://127.0.0.1:8001/status >/dev/null 2>&1; then
  export NEW_SWARM=1
  pkill -f 'uvicorn shard_manager.app' || true
  pkill -f 'petals.cli.run_server' || true
  sleep 2
  cd "$ROOT"
  nohup "$PY" -m uvicorn shard_manager.app:app --host 0.0.0.0 --port 8001 \
    > "${HOME}/blitzwing-logs/shard_manager.log" 2>&1 &
  for i in $(seq 1 240); do
    curl -sf http://127.0.0.1:8001/status >/dev/null 2>&1 && break
    sleep 5
  done
fi

PEER_ID=""
for i in $(seq 1 120); do
  PEER_LINE="$(grep -Eo '/ip4/[^ ]+/tcp/[0-9]+/p2p/[A-Za-z0-9]+' "${HOME}/blitzwing-logs/shard_manager.log" 2>/dev/null | tail -n1 || true)"
  PEER_ID="$(echo "${PEER_LINE}" | grep -Eo 'p2p/[A-Za-z0-9]+' | head -n1 | cut -d/ -f2 || true)"
  [[ -n "${PEER_ID}" ]] && break
  sleep 5
done
[[ -n "${PEER_ID}" ]] || { echo PEER_DETECT_FAILED; tail -n 100 "${HOME}/blitzwing-logs/shard_manager.log"; exit 1; }
BOOTSTRAP="/ip4/${PUBLIC_IP}/tcp/31337/p2p/${PEER_ID}"
echo "BOOTSTRAP=${BOOTSTRAP}"
grep -q '^INITIAL_PEERS=' "$ROOT/.env" && sed -i "s|^INITIAL_PEERS=.*|INITIAL_PEERS=${BOOTSTRAP}|" "$ROOT/.env" || echo "INITIAL_PEERS=${BOOTSTRAP}" >> "$ROOT/.env"

# --- orchestrator :8002 ---
pkill -f 'uvicorn orchestrator.app.main' || true
sleep 1
set -a; source "$ROOT/.env"; set +a
export PYTHONPATH="$ROOT"
export INITIAL_PEERS="${BOOTSTRAP}"
export ANNOUNCE_PEERS="${BOOTSTRAP}"
export LOAD_AT_STARTUP=1
export API_PORT=8002
cd "$ROOT"
nohup "$PY" -m uvicorn orchestrator.app.main:app --host 127.0.0.1 --port 8002 \
  > "${HOME}/blitzwing-logs/orchestrator.log" 2>&1 &
for i in $(seq 1 60); do curl -sf http://127.0.0.1:8002/health && break; sleep 2; done
curl -sf http://127.0.0.1:8002/health || { echo ORCH_FAILED; tail -n 80 "${HOME}/blitzwing-logs/orchestrator.log"; exit 1; }
echo

# --- gateway :8000 ---
cd "$ROOT/packages/x402-gateway"
npm install
pkill -f 'packages/x402-gateway' || true
pkill -f 'tsx index.ts' || true
sleep 1
set -a; source "$ROOT/.env"; set +a
nohup npx tsx index.ts > "${HOME}/blitzwing-logs/x402-gateway.log" 2>&1 &
for i in $(seq 1 30); do curl -sf http://127.0.0.1:8000/health && break; sleep 2; done
curl -s http://127.0.0.1:8000/health; echo

DISCOVERY_IP="${DISCOVERY_IP:-35.238.86.1}"
DISCOVERY_ADMIN_TOKEN="${DISCOVERY_ADMIN_TOKEN:-blitzwing-prod-admin-2026-x402}"
curl -sS -X PUT "http://${DISCOVERY_IP}:9000/v1/mothers/TinyLlama%2FTinyLlama-1.1B-Chat-v1.0" \
  -H "Authorization: Bearer ${DISCOVERY_ADMIN_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{\"mother_url\":\"http://${PUBLIC_IP}:8000\",\"total_layers\":${TOTAL_LAYERS:-22}}"
echo
echo "MOTHER_SERVICES_OK public=${PUBLIC_IP} facilitator=:8791 gateway=:8000 orch=:8002"
