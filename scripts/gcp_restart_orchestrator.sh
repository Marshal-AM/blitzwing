#!/usr/bin/env bash
# Quick restart orchestrator + gateway after git pull (mother VM).
set -euo pipefail
ROOT="${HOME}/blitzwing"
cd "$ROOT"
git fetch origin
git reset --hard origin/main

PY="${HOME}/venv/bin/python"
export PATH="${HOME}/.local/bin:${PATH}"
export PYTHONPATH="$ROOT"

set -a
# shellcheck disable=SC1091
source "$ROOT/.env"
set +a

pkill -9 -f 'uvicorn orchestrator.app.main' || true
fuser -k 8002/tcp 2>/dev/null || true
sleep 2
# Ensure port is free before bind
for i in $(seq 1 15); do
  if ! ss -ltn | grep -q ':8002'; then
    break
  fi
  fuser -k 8002/tcp 2>/dev/null || true
  sleep 1
done

export API_PORT=8002
export LOAD_AT_STARTUP=1
for _jhome in /usr/lib/jvm/java-21-openjdk-amd64 /usr/lib/jvm/default-java; do
  [[ -d "$_jhome" ]] && export JAVA_HOME="${_jhome}" && break
done
export JAVA_HOME="${JAVA_HOME:-/usr/lib/jvm/default-java}"
nohup "$PY" -m uvicorn orchestrator.app.main:app --host 127.0.0.1 --port 8002 \
  > "${HOME}/blitzwing-logs/orchestrator.log" 2>&1 &

for i in $(seq 1 60); do
  if curl -sf -m 3 http://127.0.0.1:8002/health >/dev/null; then
    echo "ORCH_OK"
    break
  fi
  sleep 2
done
curl -s -m 5 http://127.0.0.1:8002/health || { tail -n 40 "${HOME}/blitzwing-logs/orchestrator.log"; exit 1; }
echo

pkill -f 'x402-gateway/index.ts' || true
fuser -k 8000/tcp 2>/dev/null || true
sleep 1
cd "$ROOT/packages/x402-gateway"
nohup npx tsx index.ts > "${HOME}/blitzwing-logs/x402-gateway.log" 2>&1 &
for i in $(seq 1 20); do
  curl -sf -m 3 http://127.0.0.1:8000/health >/dev/null && break
  sleep 1
done
curl -s -m 5 http://127.0.0.1:8000/health
echo
echo RESTART_OK
