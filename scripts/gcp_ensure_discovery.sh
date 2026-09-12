#!/usr/bin/env bash
# Ensure discovery service is running with admin token configured.
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

export DISCOVERY_ADMIN_TOKEN="${DISCOVERY_ADMIN_TOKEN:-blitzwing-prod-admin-2026-x402}"
export DISCOVERY_DB_PATH="${DISCOVERY_DB_PATH:-${HOME}/.blitzwing/discovery.db}"
export DISCOVERY_PORT="${DISCOVERY_PORT:-9000}"
export PYTHONPATH="${ROOT}"

if curl -sf -m 5 "http://127.0.0.1:${DISCOVERY_PORT}/health" >/dev/null 2>&1; then
  echo "  OK  discovery already running"
else
  echo "==> starting discovery"
  pkill -f 'discovery_service.app:app' 2>/dev/null || true
  sleep 1
  nohup "${HOME}/venv/bin/python" -m uvicorn discovery_service.app:app \
    --host 0.0.0.0 --port "${DISCOVERY_PORT}" \
    >"${LOG}/discovery.log" 2>&1 &
  for i in $(seq 1 30); do
    curl -sf "http://127.0.0.1:${DISCOVERY_PORT}/health" >/dev/null && break
    sleep 2
  done
fi

curl -sf -m 5 "http://127.0.0.1:${DISCOVERY_PORT}/health" || { tail -20 "${LOG}/discovery.log"; exit 1; }
echo
curl -sf -m 5 "http://127.0.0.1:${DISCOVERY_PORT}/v1/mothers" | python3 -m json.tool 2>/dev/null || true
echo "GCP_DISCOVERY_OK"
