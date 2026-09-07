#!/usr/bin/env bash
# One-shot mother bootstrap: install deps, start shard-manager + orchestrator, register with Discovery.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

PUBLIC_IP="${PUBLIC_IP:?Set PUBLIC_IP to this VM's reachable IPv4}"
MODEL_NAME="${MODEL_NAME:-TinyLlama/TinyLlama-1.1B-Chat-v1.0}"
TOTAL_LAYERS="${TOTAL_LAYERS:-22}"
DISCOVERY_URL="${DISCOVERY_URL:?Set DISCOVERY_URL to the Discovery Service base URL}"
DISCOVERY_ADMIN_TOKEN="${DISCOVERY_ADMIN_TOKEN:?Set DISCOVERY_ADMIN_TOKEN}"
PETALS_PORT="${PETALS_PORT:-31337}"
ORCH_PORT="${API_PORT:-8000}"
SHARD_PORT="${SHARD_MANAGER_PORT:-8001}"
IDENTITY_PATH="${IDENTITY_PATH:-$HOME/petals-identity-mother}"
VENV="${VENV_PATH:-$HOME/venv}"
LOG_DIR="${LOG_DIR:-$HOME/blitzwing-logs}"
mkdir -p "${LOG_DIR}"

echo "==> Blitzwing mother bootstrap"
echo "    model=${MODEL_NAME} layers=0:${TOTAL_LAYERS}"
echo "    public_ip=${PUBLIC_IP}"

# --- deps ---
if [[ ! -d "${VENV}" ]]; then
  python3 -m venv "${VENV}"
fi
# shellcheck disable=SC1090
source "${VENV}/bin/activate"
pip install -U pip
pip install torch --index-url https://download.pytorch.org/whl/cpu
pip install -e "${REPO_ROOT}/petals"
pip install -r "${REPO_ROOT}/orchestrator/requirements.txt"
pip install -r "${REPO_ROOT}/shard_manager/requirements.txt"

export PYTHONPATH="${REPO_ROOT}${PYTHONPATH:+:${PYTHONPATH}}"
export MODEL_NAME TOTAL_LAYERS PUBLIC_IP
export BLOCK_INDICES="0:${TOTAL_LAYERS}"
export NEW_SWARM=1
export IDENTITY_PATH
export PETALS_PORT
export PETALS_DEVICE="${PETALS_DEVICE:-cpu}"
export PETALS_QUANT_TYPE="${PETALS_QUANT_TYPE:-none}"
export SHARD_AUTO_START=1
export MOTHER_SHARD_MANAGER_URL="http://127.0.0.1:${SHARD_PORT}"
export API_HOST=0.0.0.0
export API_PORT="${ORCH_PORT}"
export LOAD_AT_STARTUP=0

# --- shard manager (starts Petals with full range) ---
if [[ -f "${LOG_DIR}/shard_manager.pid" ]] && kill -0 "$(cat "${LOG_DIR}/shard_manager.pid")" 2>/dev/null; then
  echo "Shard manager already running"
else
  echo "==> Starting shard manager on :${SHARD_PORT}"
  nohup python -m uvicorn shard_manager.app:app --host 0.0.0.0 --port "${SHARD_PORT}" \
    >"${LOG_DIR}/shard_manager.log" 2>&1 &
  echo $! >"${LOG_DIR}/shard_manager.pid"
fi

echo "==> Waiting for Petals / shard manager..."
for i in $(seq 1 60); do
  if curl -sf "http://127.0.0.1:${SHARD_PORT}/status" | grep -q '"running":true\|"running": true'; then
    break
  fi
  sleep 2
done

# Extract peer multiaddr from Petals logs (best-effort)
PEER_LINE="$(grep -Eo '/ip4/[^ ]+/tcp/[0-9]+/p2p/[A-Za-z0-9]+' "${LOG_DIR}/shard_manager.log" 2>/dev/null | tail -n1 || true)"
if [[ -z "${PEER_LINE}" ]]; then
  # Fallback: construct from identity is hard; ask operator to paste later
  BOOTSTRAP="/ip4/${PUBLIC_IP}/tcp/${PETALS_PORT}/p2p/PEER_ID_FROM_LOGS"
  echo "WARNING: Could not auto-detect peer id. Check ${LOG_DIR}/shard_manager.log"
  echo "         Set INITIAL_PEERS once you see /p2p/<id>, then restart orchestrator."
else
  # Prefer announcing with PUBLIC_IP
  PEER_ID="$(echo "${PEER_LINE}" | grep -Eo 'p2p/[A-Za-z0-9]+' | head -n1 | cut -d/ -f2)"
  BOOTSTRAP="/ip4/${PUBLIC_IP}/tcp/${PETALS_PORT}/p2p/${PEER_ID}"
fi

export INITIAL_PEERS="${BOOTSTRAP}"
export LOAD_AT_STARTUP=1

# --- orchestrator ---
if [[ -f "${LOG_DIR}/orchestrator.pid" ]] && kill -0 "$(cat "${LOG_DIR}/orchestrator.pid")" 2>/dev/null; then
  echo "Orchestrator already running"
else
  echo "==> Starting orchestrator on :${ORCH_PORT}"
  nohup python -m uvicorn orchestrator.app.main:app --host 0.0.0.0 --port "${ORCH_PORT}" \
    >"${LOG_DIR}/orchestrator.log" 2>&1 &
  echo $! >"${LOG_DIR}/orchestrator.pid"
fi

sleep 2

# Persist env for restarts
cat >"${REPO_ROOT}/orchestrator/.env" <<EOF
MODEL_NAME=${MODEL_NAME}
TOTAL_LAYERS=${TOTAL_LAYERS}
INITIAL_PEERS=${BOOTSTRAP}
API_HOST=0.0.0.0
API_PORT=${ORCH_PORT}
MOTHER_SHARD_MANAGER_URL=http://127.0.0.1:${SHARD_PORT}
LOAD_AT_STARTUP=1
EOF

# --- register with discovery ---
MOTHER_URL="http://${PUBLIC_IP}:${ORCH_PORT}"
echo "==> Registering with Discovery Service ${DISCOVERY_URL}"
set +e
REGISTER_BODY="$(curl -sS -X POST "${DISCOVERY_URL%/}/v1/mothers/register" \
  -H "Authorization: Bearer ${DISCOVERY_ADMIN_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{\"model\":\"${MODEL_NAME}\",\"mother_url\":\"${MOTHER_URL}\",\"total_layers\":${TOTAL_LAYERS}}")"
REGISTER_CODE=$?
set -e
echo "${REGISTER_BODY}"
if echo "${REGISTER_BODY}" | grep -q 'already registered'; then
  echo "==> Model already registered; updating mother_url"
  ENCODED="$(python3 -c "import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1], safe=''))" "${MODEL_NAME}")"
  curl -sS -X PUT "${DISCOVERY_URL%/}/v1/mothers/${ENCODED}" \
    -H "Authorization: Bearer ${DISCOVERY_ADMIN_TOKEN}" \
    -H "Content-Type: application/json" \
    -d "{\"mother_url\":\"${MOTHER_URL}\",\"total_layers\":${TOTAL_LAYERS}}"
  echo
fi

echo
echo "=============================================="
echo " Mother is up"
echo "   API:        ${MOTHER_URL}"
echo "   Bootstrap:  ${BOOTSTRAP}"
echo "   Discovery:  ${DISCOVERY_URL}"
echo
echo " Contributors run:"
echo "   npm i -g blitzwing && blitzwing"
echo "=============================================="
