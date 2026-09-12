#!/usr/bin/env bash
set -euo pipefail
ROOT="${HOME}/blitzwing"
LOG="${HOME}/blitzwing-logs"
PY="${HOME}/venv/bin/python"

echo "==> stopping orchestrator"
pkill -9 -f 'uvicorn orchestrator.app.main' 2>/dev/null || true
for _ in $(seq 1 15); do
  pgrep -f 'uvicorn orchestrator.app.main' >/dev/null || break
  sleep 1
done
if pgrep -f 'uvicorn orchestrator.app.main' >/dev/null; then
  echo "ORCH_STOP_FAILED — stale PIDs still on :8002"
  pgrep -af 'uvicorn orchestrator.app.main' || true
  exit 1
fi

set -a; source "${ROOT}/.env"; set +a
export PYTHONPATH="${ROOT}"
export API_PORT=8002
export LOAD_AT_STARTUP=1
export MOTHER_PUBLIC_GATEWAY_URL="${MOTHER_PUBLIC_GATEWAY_URL:-http://$(curl -s --max-time 10 ifconfig.me):8000}"

echo "==> starting orchestrator (Petals load may take ~2 min)"
nohup "${PY}" -m uvicorn orchestrator.app.main:app --host 127.0.0.1 --port 8002 \
  >"${LOG}/orchestrator.log" 2>&1 &
ORCH_PID=$!
echo "orchestrator_pid=${ORCH_PID}"

for i in $(seq 1 90); do
  if curl -sf http://127.0.0.1:8002/health >/dev/null 2>&1; then
    echo "orchestrator healthy after ${i} attempts"
    break
  fi
  if ! kill -0 "${ORCH_PID}" 2>/dev/null; then
    echo "ORCH_EXITED — tailing log"
    tail -30 "${LOG}/orchestrator.log" || true
    exit 1
  fi
  if [[ $((i % 10)) -eq 0 ]]; then
    echo "  waiting for orchestrator... attempt ${i}/90"
    tail -3 "${LOG}/orchestrator.log" 2>/dev/null || true
  fi
  sleep 2
done
curl -sf http://127.0.0.1:8002/health || { tail -30 "${LOG}/orchestrator.log"; exit 1; }
echo
sleep 3
curl -sf http://127.0.0.1:8000/v1/hosts | python3 -m json.tool
echo "ORCH_ENS_SYNC_OK"
