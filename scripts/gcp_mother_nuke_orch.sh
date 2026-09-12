#!/usr/bin/env bash
set -euo pipefail
ROOT="${HOME}/blitzwing"
LOG="${HOME}/blitzwing-logs"
PY="${HOME}/venv/bin/python"

echo "=== kill all orchestrators ==="
pkill -9 -f 'uvicorn orchestrator.app.main' 2>/dev/null || true
sleep 3
pgrep -af orchestrator || echo "no orchestrator procs"

echo "=== start single orchestrator ==="
set -a; source "${ROOT}/.env"; set +a
export PYTHONPATH="${ROOT}"
export API_PORT=8002
export LOAD_AT_STARTUP=1
nohup "$PY" -m uvicorn orchestrator.app.main:app --host 127.0.0.1 --port 8002 \
  > "${LOG}/orchestrator.log" 2>&1 &
echo "orch_pid=$!"

echo "=== waiting for health (up to 3 min) ==="
for i in $(seq 1 60); do
  if curl -sf -m 5 http://127.0.0.1:8002/health >/dev/null 2>&1; then
    echo "orch healthy after ${i}*3s"
    break
  fi
  sleep 3
done

curl -s -m 10 http://127.0.0.1:8002/health; echo
curl -s -m 10 http://127.0.0.1:8000/health; echo
curl -s -m 10 http://127.0.0.1:8000/v1/hosts; echo
echo "ORCH_NUKE_OK"
