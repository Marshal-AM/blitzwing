#!/usr/bin/env bash
# Recover mother services after a bad restart (duplicate processes / port conflict).
set -euo pipefail

ROOT="${HOME}/blitzwing"
PY="${HOME}/venv/bin/python"
export PYTHONPATH="$ROOT"

pkill -f 'uvicorn orchestrator.app.main' || true
pkill -f 'x402-gateway/index.ts' || true
sleep 3

echo "=== Remaining orchestrator PIDs ==="
pgrep -af 'orchestrator.app.main' || echo "(none)"

echo "=== Port 8002 ==="
ss -lntp | grep ':8002' || echo "(free)"

set -a
# shellcheck disable=SC1091
source "$ROOT/.env"
set +a

export API_PORT=8002
export LOAD_AT_STARTUP=1
nohup "$PY" -m uvicorn orchestrator.app.main:app --host 127.0.0.1 --port 8002 \
  > "${HOME}/blitzwing-logs/orchestrator.log" 2>&1 &

echo "Waiting for orchestrator..."
for i in $(seq 1 90); do
  if curl -sf http://127.0.0.1:8002/health >/dev/null; then
    echo "ORCH_OK"
    break
  fi
  sleep 4
done
curl -s http://127.0.0.1:8002/health || { tail -n 30 "${HOME}/blitzwing-logs/orchestrator.log"; exit 1; }
echo

cd "$ROOT/packages/x402-gateway"
nohup npx tsx index.ts > "${HOME}/blitzwing-logs/x402-gateway.log" 2>&1 &

echo "Waiting for gateway..."
for i in $(seq 1 30); do
  if curl -sf http://127.0.0.1:8000/health >/dev/null; then
    echo "GW_OK"
    break
  fi
  sleep 2
done
curl -s http://127.0.0.1:8000/health
echo
echo "RECOVER_OK"
