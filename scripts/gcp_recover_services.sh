#!/usr/bin/env bash
# Recover mother services after a bad restart (duplicate processes / port conflict).
set -euo pipefail

ROOT="${HOME}/blitzwing"
PY="${HOME}/venv/bin/python"
export PYTHONPATH="$ROOT"

# pkill often leaves wedged uvicorn workers on :8002 — use kill -9 on each PID.
for pid in $(pgrep -f 'uvicorn orchestrator.app.main' 2>/dev/null || true); do
  kill -9 "$pid" 2>/dev/null || true
done
for pid in $(pgrep -f 'x402-gateway/index.ts' 2>/dev/null || true); do
  kill -9 "$pid" 2>/dev/null || true
done
pkill -9 -f 'gcp_restart_orchestrator' 2>/dev/null || true
sleep 3

# Clear corrupted HCS topic cache (Java object repr instead of 0.0.xxx).
HCS_CACHE="${HOME}/.blitzwing/hcs_topic_id"
if [[ -f "$HCS_CACHE" ]] && ! grep -qE '^0\.0\.[0-9]+$' "$HCS_CACHE"; then
  echo "Removing invalid HCS topic cache: $(head -c 80 "$HCS_CACHE")"
  rm -f "$HCS_CACHE"
fi

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
