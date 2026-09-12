#!/usr/bin/env bash
# Start discovery + mother shard-manager + orchestrator for local testing (WSL).
set -euo pipefail

ROOT=/mnt/c/Users/MSI/Desktop/blitzwing
LOG=~/blitzwing-logs
mkdir -p "$LOG"
# shellcheck disable=SC1090
source ~/.blitzwing-venv/bin/activate
cd "$ROOT"
export PYTHONPATH="$ROOT"

export DISCOVERY_ADMIN_TOKEN="${DISCOVERY_ADMIN_TOKEN:-local-dev-token}"
export DISCOVERY_DB_PATH="$HOME/.blitzwing/discovery.db"
export DISCOVERY_PORT=9000

# Prefer LAN IP so another machine on the same network can reach us; fallback localhost.
LAN_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
PUBLIC_IP="${PUBLIC_IP:-$LAN_IP}"
if [[ -z "$PUBLIC_IP" ]]; then PUBLIC_IP=127.0.0.1; fi

export MODEL_NAME="${MODEL_NAME:-HuggingFaceTB/SmolLM2-360M-Instruct}"
export TOTAL_LAYERS="${TOTAL_LAYERS:-32}"
export PUBLIC_IP
export BLOCK_INDICES="0:${TOTAL_LAYERS}"
export NEW_SWARM=1
export IDENTITY_PATH="$HOME/.blitzwing/petals-identity-mother"
export PETALS_PORT=31337
export PETALS_DEVICE=cpu
export PETALS_QUANT_TYPE=none
export PETALS_PYTHON="$HOME/.blitzwing-venv/bin/python"
export SHARD_AUTO_START=1
export SHARD_PORT=8001
export MOTHER_SHARD_MANAGER_URL="http://127.0.0.1:${SHARD_PORT}"
export API_HOST=0.0.0.0
export API_PORT=8000
export LOAD_AT_STARTUP=0

stop_pid() {
  local f="$1"
  if [[ -f "$f" ]]; then
    kill "$(cat "$f")" 2>/dev/null || true
    rm -f "$f"
  fi
}

stop_pid "$LOG/discovery.pid"
stop_pid "$LOG/shard.pid"
stop_pid "$LOG/orch.pid"

echo "==> Starting Discovery on :9000"
nohup python -m uvicorn discovery_service.app:app --host 0.0.0.0 --port 9000 \
  >"$LOG/discovery.log" 2>&1 &
echo $! >"$LOG/discovery.pid"

echo "==> Starting shard manager (Petals 0:${TOTAL_LAYERS}) on :8001"
nohup python -m uvicorn shard_manager.app:app --host 0.0.0.0 --port 8001 \
  >"$LOG/shard.log" 2>&1 &
echo $! >"$LOG/shard.pid"

echo "==> Waiting for Petals to come up (first run downloads SmolLM2 weights)..."
for i in $(seq 1 180); do
  if curl -sf http://127.0.0.1:8001/status | grep -q '"running": true\|"running":true'; then
    echo "    shard manager reports running after ${i} checks"
    break
  fi
  sleep 5
done

# Peer multiaddr from logs
PEER_LINE="$(grep -Eo '/ip4/[^ ]+/tcp/[0-9]+/p2p/[A-Za-z0-9]+' "$LOG/shard.log" 2>/dev/null | tail -n1 || true)"
if [[ -n "$PEER_LINE" ]]; then
  PEER_ID="$(echo "$PEER_LINE" | sed -n 's#.*/p2p/\([^/]*\).*#\1#p')"
  BOOTSTRAP="/ip4/${PUBLIC_IP}/tcp/${PETALS_PORT}/p2p/${PEER_ID}"
else
  BOOTSTRAP="/ip4/${PUBLIC_IP}/tcp/${PETALS_PORT}/p2p/UNKNOWN"
  echo "WARNING: peer id not found yet; check $LOG/shard.log"
fi
export INITIAL_PEERS="$BOOTSTRAP"
export LOAD_AT_STARTUP=1

echo "==> Starting orchestrator on :8000 (INITIAL_PEERS=$INITIAL_PEERS)"
nohup python -m uvicorn orchestrator.app.main:app --host 0.0.0.0 --port 8000 \
  >"$LOG/orch.log" 2>&1 &
echo $! >"$LOG/orch.pid"

sleep 3

MOTHER_URL="http://${PUBLIC_IP}:8000"
DISCOVERY_URL="http://${PUBLIC_IP}:9000"

echo "==> Registering mother with Discovery"
curl -sS -X POST "${DISCOVERY_URL}/v1/mothers/register" \
  -H "Authorization: Bearer ${DISCOVERY_ADMIN_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{\"model\":\"${MODEL_NAME}\",\"mother_url\":\"${MOTHER_URL}\",\"total_layers\":${TOTAL_LAYERS}}" \
  || true

# If already registered, update URL
ENCODED="$(python -c 'import urllib.parse,os; print(urllib.parse.quote(os.environ["MODEL_NAME"], safe=""))')"
curl -sS -X PUT "${DISCOVERY_URL}/v1/mothers/${ENCODED}" \
  -H "Authorization: Bearer ${DISCOVERY_ADMIN_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{\"mother_url\":\"${MOTHER_URL}\",\"total_layers\":${TOTAL_LAYERS}}" || true

echo
echo "=============================================="
echo " LOCAL STACK UP"
echo "   Discovery:  ${DISCOVERY_URL}"
echo "   Mother API: ${MOTHER_URL}"
echo "   Shard mgr:  http://${PUBLIC_IP}:8001"
echo "   Bootstrap:  ${BOOTSTRAP}"
echo "   Admin tok:  ${DISCOVERY_ADMIN_TOKEN}"
echo
echo " Health:"
curl -sS http://127.0.0.1:9000/health || true; echo
curl -sS http://127.0.0.1:8000/health || true; echo
curl -sS http://127.0.0.1:8001/status || true; echo
echo "=============================================="
