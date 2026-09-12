#!/usr/bin/env bash
# Ensure every Blitzwing service is running on the mother VM (facilitator, ENS, petals, orch, gateway).
set -euo pipefail

ROOT="${HOME}/blitzwing"
LOG="${HOME}/blitzwing-logs"
PY="${HOME}/venv/bin/python"
PUBLIC_IP="${PUBLIC_IP:-$(curl -s --max-time 10 ifconfig.me)}"
DISCOVERY_IP="${DISCOVERY_IP:-34.70.57.65}"
DISCOVERY_ADMIN_TOKEN="${DISCOVERY_ADMIN_TOKEN:-blitzwing-prod-admin-2026-x402}"

mkdir -p "${LOG}"
cd "${ROOT}"

if [[ -f "${ROOT}/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "${ROOT}/.env"
  set +a
fi

ok() { echo "  OK  $1"; }
fail() { echo "  FAIL $1"; FAIL=1; }
FAIL=0

echo "========== ENSURE FULL MOTHER STACK =========="
echo "public_ip=${PUBLIC_IP}"

# --- facilitator :8791 ---
if curl -sf -m 5 http://127.0.0.1:8791/health >/dev/null 2>&1; then
  ok "facilitator :8791"
else
  echo "==> starting facilitator"
  cd "${ROOT}/packages/x402-facilitator"
  npm install --silent 2>/dev/null || npm install
  pkill -f 'x402-facilitator/index.ts' 2>/dev/null || true
  sleep 1
  set -a; source "${ROOT}/.env"; set +a
  nohup npx tsx index.ts >"${LOG}/facilitator.log" 2>&1 &
  for i in $(seq 1 30); do curl -sf http://127.0.0.1:8791/health >/dev/null && break; sleep 2; done
  curl -sf -m 5 http://127.0.0.1:8791/health >/dev/null && ok "facilitator :8791" || fail "facilitator :8791"
fi

# --- ENS service :8792 ---
if [[ "${ENS_ENABLED:-0}" == "1" ]]; then
  if curl -sf -m 5 http://127.0.0.1:8792/health >/dev/null 2>&1; then
    ok "ens-service :8792"
  else
    echo "==> starting ENS service"
    cd "${ROOT}/packages/ens-service"
    npm install --silent 2>/dev/null || npm install
    pkill -f 'packages/ens-service' 2>/dev/null || true
    pkill -f 'ens-service/src/server' 2>/dev/null || true
    sleep 1
    set -a; source "${ROOT}/.env"; set +a
    nohup npx tsx src/server.ts >"${LOG}/ens-service.log" 2>&1 &
    echo $! >"${LOG}/ens-service.pid"
    for i in $(seq 1 30); do curl -sf http://127.0.0.1:8792/health >/dev/null && break; sleep 2; done
    curl -sf -m 5 http://127.0.0.1:8792/health >/dev/null && ok "ens-service :8792" || { fail "ens-service :8792"; tail -20 "${LOG}/ens-service.log" || true; }
  fi
else
  echo "  SKIP ens-service (ENS_ENABLED!=1 — set ENS_ENABLED=1 in .env)"
  FAIL=1
fi

# --- shard manager + petals :8001 / :31337 ---
if curl -sf -m 5 http://127.0.0.1:8001/status >/dev/null 2>&1; then
  ok "shard_manager :8001"
else
  echo "==> starting shard manager + petals"
  export PYTHONPATH="${ROOT}"
  export MODEL_NAME="${MODEL_NAME:-HuggingFaceTB/SmolLM2-360M-Instruct}"
  export BLOCK_INDICES="${BLOCK_INDICES:-0:32}"
  export NEW_SWARM="${NEW_SWARM:-1}"
  export IDENTITY_PATH="${HOME}/.blitzwing/petals-identity-mother"
  export PETALS_PORT=31337
  export PETALS_DEVICE=cpu
  export PETALS_QUANT_TYPE=none
  export PETALS_PYTHON="${PY}"
  export PETALS_SERVER_LOG="${LOG}/shard_manager.log"
  export SHARD_AUTO_START=1
  export ANNOUNCE_MADDRS="/ip4/${PUBLIC_IP}/tcp/31337"
  export PUBLIC_IP
  pkill -f 'uvicorn shard_manager.app' 2>/dev/null || true
  pkill -f 'petals.cli.run_server' 2>/dev/null || true
  sleep 2
  cd "${ROOT}"
  nohup "${PY}" -m uvicorn shard_manager.app:app --host 0.0.0.0 --port 8001 \
    >"${LOG}/shard_manager.log" 2>&1 &
  for i in $(seq 1 120); do
    curl -sf http://127.0.0.1:8001/status >/dev/null 2>&1 && break
    sleep 5
  done
  curl -sf -m 5 http://127.0.0.1:8001/status >/dev/null && ok "shard_manager :8001" || fail "shard_manager :8001"
fi

if pgrep -f 'petals.cli.run_server.*petals-identity-mother' >/dev/null 2>&1; then
  ok "petals mother :31337"
else
  fail "petals mother :31337 (not running)"
fi

# --- detect bootstrap peer ---
PEER_LINE="$(grep -Eo '/ip4/[^ ]+/tcp/[0-9]+/p2p/[A-Za-z0-9]+' "${LOG}/shard_manager.log" 2>/dev/null | tail -n1 || true)"
if [[ -n "${PEER_LINE}" ]]; then
  grep -q '^INITIAL_PEERS=' "${ROOT}/.env" \
    && sed -i "s|^INITIAL_PEERS=.*|INITIAL_PEERS=${PEER_LINE}|" "${ROOT}/.env" \
    || echo "INITIAL_PEERS=${PEER_LINE}" >> "${ROOT}/.env"
  ok "bootstrap peer ${PEER_LINE}"
fi

# --- orchestrator :8002 ---
if curl -sf -m 5 http://127.0.0.1:8002/health >/dev/null 2>&1; then
  ok "orchestrator :8002"
else
  echo "==> starting orchestrator"
  pkill -f 'uvicorn orchestrator.app.main' 2>/dev/null || true
  sleep 2
  set -a; source "${ROOT}/.env"; set +a
  export PYTHONPATH="${ROOT}"
  export API_PORT=8002
  export LOAD_AT_STARTUP=1
  export MOTHER_PUBLIC_GATEWAY_URL="http://${PUBLIC_IP}:8000"
  nohup "${PY}" -m uvicorn orchestrator.app.main:app --host 127.0.0.1 --port 8002 \
    >"${LOG}/orchestrator.log" 2>&1 &
  for i in $(seq 1 60); do curl -sf http://127.0.0.1:8002/health >/dev/null && break; sleep 2; done
  curl -sf -m 5 http://127.0.0.1:8002/health >/dev/null && ok "orchestrator :8002" || fail "orchestrator :8002"
fi

# --- gateway :8000 ---
if curl -sf -m 5 http://127.0.0.1:8000/health >/dev/null 2>&1; then
  ok "gateway :8000"
else
  echo "==> starting x402 gateway"
  cd "${ROOT}/packages/x402-gateway"
  npm install --silent 2>/dev/null || npm install
  pkill -f 'x402-gateway/index.ts' 2>/dev/null || true
  sleep 1
  set -a; source "${ROOT}/.env"; set +a
  export MOTHER_PUBLIC_GATEWAY_URL="http://${PUBLIC_IP}:8000"
  nohup npx tsx index.ts >"${LOG}/x402-gateway.log" 2>&1 &
  for i in $(seq 1 30); do curl -sf http://127.0.0.1:8000/health >/dev/null && break; sleep 2; done
  curl -sf -m 5 http://127.0.0.1:8000/health >/dev/null && ok "gateway :8000" || fail "gateway :8000"
fi

# --- register with discovery ---
echo "==> registering mother with discovery"
curl -sS -X PUT "http://${DISCOVERY_IP}:9000/v1/mothers/HuggingFaceTB%2FSmolLM2-360M-Instruct" \
  -H "Authorization: Bearer ${DISCOVERY_ADMIN_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{\"mother_url\":\"http://${PUBLIC_IP}:8000\",\"total_layers\":${TOTAL_LAYERS:-32}}" || true
echo

echo ""
echo "--- swarm ---"
curl -sf -m 5 http://127.0.0.1:8000/v1/hosts | python3 -m json.tool 2>/dev/null || true

echo ""
if [[ "$FAIL" -eq 0 ]]; then
  echo "GCP_ENSURE_ALL_OK"
  exit 0
else
  echo "GCP_ENSURE_ALL_FAILED"
  exit 1
fi
