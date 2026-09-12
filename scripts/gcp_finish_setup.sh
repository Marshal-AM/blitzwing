#!/usr/bin/env bash
# Finalize GCP mother: longer pending TTL, optional ENS service, orchestrator restart.
set -euo pipefail
ROOT="${HOME}/blitzwing"
LOG="${HOME}/blitzwing-logs"
cd "$ROOT"

touch "${ROOT}/.env"
grep -q '^PENDING_TTL_SECONDS=' "${ROOT}/.env" \
  && sed -i 's/^PENDING_TTL_SECONDS=.*/PENDING_TTL_SECONDS=600/' "${ROOT}/.env" \
  || echo 'PENDING_TTL_SECONDS=600' >> "${ROOT}/.env"

if [[ "${START_ENS_SERVICE:-1}" == "1" ]] && grep -q '^ENS_ENABLED=1' "${ROOT}/.env"; then
  echo "== start ENS service :8792 =="
  cd "${ROOT}/packages/ens-service"
  npm install --silent 2>/dev/null || npm install
  pkill -f 'packages/ens-service' 2>/dev/null || true
  pkill -f 'ens-service/src/server' 2>/dev/null || true
  sleep 1
  set -a; source "${ROOT}/.env"; set +a
  nohup npx tsx src/server.ts > "${LOG}/ens-service.log" 2>&1 &
  for i in $(seq 1 30); do curl -sf http://127.0.0.1:8792/health && break; sleep 2; done
  curl -sf http://127.0.0.1:8792/health || { tail -20 "${LOG}/ens-service.log"; exit 1; }
  echo
fi

echo "== restart orchestrator =="
pkill -f 'uvicorn orchestrator.app.main' || true
sleep 2
set -a; source "${ROOT}/.env"; set +a
export PYTHONPATH="${ROOT}"
export API_PORT=8002
PY="${HOME}/venv/bin/python"
nohup "$PY" -m uvicorn orchestrator.app.main:app --host 127.0.0.1 --port 8002 \
  > "${LOG}/orchestrator.log" 2>&1 &
for i in $(seq 1 60); do curl -sf http://127.0.0.1:8002/health && break; sleep 2; done
curl -s http://127.0.0.1:8002/health; echo
curl -s http://127.0.0.1:8000/v1/hosts; echo
echo "GCP_FINISH_SETUP_OK"
