#!/usr/bin/env bash
set -euo pipefail
ROOT="${HOME}/blitzwing"
LOG="${HOME}/blitzwing-logs/shard_manager.log"
PY="${HOME}/venv/bin/python"

echo "waiting for peer in shard log…"
PEER=""
for i in $(seq 1 90); do
  PEER="$(grep -Eo '/ip4/[^ ]+/tcp/[0-9]+/p2p/[A-Za-z0-9]+' "$LOG" | tail -n1 || true)"
  if [[ -n "$PEER" ]]; then
    echo "FOUND=$PEER after $((i*5))s"
    break
  fi
  if (( i % 6 == 0 )); then
    curl -sS http://127.0.0.1:8001/status || true
    echo
    tail -n 3 "$LOG" || true
  fi
  sleep 5
done
[[ -n "$PEER" ]] || { echo FAIL_NO_PEER; tail -n 100 "$LOG"; exit 1; }

if grep -q '^INITIAL_PEERS=' "$ROOT/.env"; then
  sed -i "s|^INITIAL_PEERS=.*|INITIAL_PEERS=${PEER}|" "$ROOT/.env"
else
  echo "INITIAL_PEERS=${PEER}" >> "$ROOT/.env"
fi

pkill -f 'uvicorn orchestrator.app.main' || true
sleep 1
set -a
# shellcheck disable=SC1091
source "$ROOT/.env"
set +a
export PYTHONPATH="$ROOT"
export INITIAL_PEERS="$PEER"
export ANNOUNCE_PEERS="$PEER"
export LOAD_AT_STARTUP=1
export API_PORT=8002
nohup "$PY" -m uvicorn orchestrator.app.main:app --host 127.0.0.1 --port 8002 \
  > "${HOME}/blitzwing-logs/orchestrator.log" 2>&1 &
for i in $(seq 1 60); do
  curl -sf http://127.0.0.1:8002/health && break
  sleep 2
done
echo
curl -sS http://127.0.0.1:8000/v1/hosts; echo
curl -sS http://127.0.0.1:8001/status; echo
echo FINISH_OK
