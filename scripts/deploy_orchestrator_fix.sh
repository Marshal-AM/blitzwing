#!/usr/bin/env bash
# Deploy orchestrator fix to GCP mother VM (run on the mother VM).
set -euo pipefail

ROOT="${HOME}/blitzwing"
cd "$ROOT"

echo "=== Pulling latest changes ==="
git fetch origin
git reset --hard origin/main

PY="${HOME}/venv/bin/python"
export PYTHONPATH="$ROOT"
set -a; source "$ROOT/.env"; set +a

echo "=== Restarting orchestrator ==="
pkill -f 'uvicorn orchestrator.app.main' || true
sleep 2

export API_PORT=8002
export LOAD_AT_STARTUP=1
nohup "$PY" -m uvicorn orchestrator.app.main:app --host 127.0.0.1 --port 8002 \
  > "${HOME}/blitzwing-logs/orchestrator.log" 2>&1 &

for i in $(seq 1 60); do
  curl -sf http://127.0.0.1:8002/health >/dev/null && break
  sleep 2
done
curl -s http://127.0.0.1:8002/health
echo

echo "=== Restarting x402-gateway ==="
pkill -f 'x402-gateway/index.ts' || true
sleep 1
cd "$ROOT/packages/x402-gateway"
nohup npx tsx index.ts > "${HOME}/blitzwing-logs/x402-gateway.log" 2>&1 &

for i in $(seq 1 20); do
  curl -sf http://127.0.0.1:8000/health >/dev/null && break
  sleep 1
done
curl -s http://127.0.0.1:8000/health
echo
echo "=== DEPLOY COMPLETE ==="
