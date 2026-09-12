#!/usr/bin/env bash
set -euo pipefail
ROOT="${HOME}/blitzwing"
LOG="${HOME}/blitzwing-logs"
PY="${HOME}/venv/bin/python"
PUBLIC_IP="${PUBLIC_IP:-$(curl -s --max-time 10 ifconfig.me)}"

echo "=== $(hostname) process check ==="
ps aux | grep -E 'orchestrator|shard_manager|x402-gateway|x402-facilitator|ens-service' | grep -v grep || echo NO_PROCS
ss -tlnp | grep -E ':8000|:8001|:8002|:8791|:8792' || echo NO_PORTS

echo "=== ensure facilitator + gateway ==="
if ! curl -sf http://127.0.0.1:8791/health >/dev/null 2>&1; then
  cd "${ROOT}/packages/x402-facilitator"
  pkill -f 'x402-facilitator' || true
  sleep 1
  set -a; source "${ROOT}/.env"; set +a
  nohup npx tsx index.ts > "${LOG}/facilitator.log" 2>&1 &
fi

if ! curl -sf http://127.0.0.1:8000/health >/dev/null 2>&1; then
  cd "${ROOT}/packages/x402-gateway"
  pkill -f 'x402-gateway' || true
  sleep 1
  set -a; source "${ROOT}/.env"; set +a
  export MOTHER_PUBLIC_GATEWAY_URL="http://${PUBLIC_IP}:8000"
  nohup npx tsx index.ts > "${LOG}/x402-gateway.log" 2>&1 &
fi

echo "=== ensure orchestrator ==="
if ! curl -sf http://127.0.0.1:8002/health >/dev/null 2>&1; then
  pkill -f 'uvicorn orchestrator.app.main' || true
  sleep 2
  set -a; source "${ROOT}/.env"; set +a
  export PYTHONPATH="${ROOT}"
  export API_PORT=8002
  export LOAD_AT_STARTUP=1
  nohup "$PY" -m uvicorn orchestrator.app.main:app --host 127.0.0.1 --port 8002 \
    > "${LOG}/orchestrator.log" 2>&1 &
fi

echo "=== wait for services ==="
for i in $(seq 1 90); do
  curl -sf http://127.0.0.1:8002/health >/dev/null 2>&1 && \
  curl -sf http://127.0.0.1:8000/health >/dev/null 2>&1 && break
  sleep 3
done

echo "=== health ==="
curl -s http://127.0.0.1:8791/health; echo
curl -s http://127.0.0.1:8002/health; echo
curl -s http://127.0.0.1:8000/health; echo
curl -s http://127.0.0.1:8000/v1/hosts; echo
echo "MOTHER_RECOVER_OK ip=${PUBLIC_IP}"
