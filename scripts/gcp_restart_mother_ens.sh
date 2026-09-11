#!/usr/bin/env bash
# Restart mother stack with ENS service (facilitator → ens-service → orchestrator → gateway).
set -euo pipefail

ROOT="${HOME}/blitzwing"
LOG="${HOME}/blitzwing-logs"
mkdir -p "${LOG}"

if [[ -f "${ROOT}/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "${ROOT}/.env"
  set +a
fi

stop_pid() {
  local f="$1"
  if [[ -f "${f}" ]]; then
    local pid
    pid="$(cat "${f}")"
    kill "${pid}" 2>/dev/null || true
    rm -f "${f}"
  fi
}

echo "==> Stopping existing services"
stop_pid "${LOG}/facilitator.pid"
stop_pid "${LOG}/ens-service.pid"
stop_pid "${LOG}/orchestrator.pid"
stop_pid "${LOG}/gateway.pid"

export ENS_ENABLED="${ENS_ENABLED:-1}"
export ENS_SERVICE_URL="${ENS_SERVICE_URL:-http://127.0.0.1:8792}"

echo "==> Starting facilitator"
cd "${ROOT}/packages/x402-facilitator"
nohup npm start >"${LOG}/facilitator.log" 2>&1 &
echo $! >"${LOG}/facilitator.pid"
sleep 2

echo "==> Starting ENS service"
cd "${ROOT}/packages/ens-service"
npm install --silent 2>/dev/null || npm install
nohup npm start >"${LOG}/ens-service.log" 2>&1 &
echo $! >"${LOG}/ens-service.pid"
for i in $(seq 1 30); do
  curl -sf "${ENS_SERVICE_URL}/health" >/dev/null && break
  sleep 1
done
curl -sf "${ENS_SERVICE_URL}/health" || { echo "ENS service failed to start"; tail -20 "${LOG}/ens-service.log"; exit 1; }

echo "==> Starting orchestrator"
cd "${ROOT}"
export API_PORT="${API_PORT:-8002}"
export PYTHONPATH="${ROOT}${PYTHONPATH:+:${PYTHONPATH}}"
nohup python -m uvicorn orchestrator.app.main:app --host 0.0.0.0 --port "${API_PORT}" \
  >"${LOG}/orchestrator.log" 2>&1 &
echo $! >"${LOG}/orchestrator.pid"
sleep 2

echo "==> Starting x402 gateway"
cd "${ROOT}/packages/x402-gateway"
nohup npm start >"${LOG}/x402-gateway.log" 2>&1 &
echo $! >"${LOG}/gateway.pid"

echo "==> Mother stack up (ENS_ENABLED=${ENS_ENABLED})"
curl -sf "http://127.0.0.1:${API_PORT}/health" | python3 -m json.tool || true
curl -sf "${ENS_SERVICE_URL}/health" | python3 -m json.tool || true
