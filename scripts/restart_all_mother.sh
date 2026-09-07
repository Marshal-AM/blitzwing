#!/usr/bin/env bash
# Kill and restart the full mother stack in WSL (discovery, shard manager, orchestrator, ngrok).
set -euo pipefail
source "$HOME/.blitzwing-venv/bin/activate"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
export PYTHONPATH="$ROOT"

PEER=QmR5t2FooNSjTn8KhQos6CHnn1gy7DRDGbbUoR2MKn5vey
DISCOVERY_TOKEN="${DISCOVERY_ADMIN_TOKEN:-local-dev-token}"
DISCOVERY_DB="${DISCOVERY_DB_PATH:-$HOME/.blitzwing/discovery.db}"
NGROK_CFG="$ROOT/scripts/ngrok.yml"

echo "== kill everything =="
fuser -k 9000/tcp 8000/tcp 8001/tcp 31337/tcp 4040/tcp 2>/dev/null || true
pkill -9 -f 'ngrok start' 2>/dev/null || true
pkill -9 -f 'discovery_service.app' 2>/dev/null || true
pkill -9 -f 'uvicorn orchestrator.app.main' 2>/dev/null || true
pkill -9 -f 'uvicorn shard_manager.app' 2>/dev/null || true
pkill -9 -f 'petals.cli.run_server' 2>/dev/null || true
pkill -9 -f 'hivemind_cli/p2pd' 2>/dev/null || true
sleep 3
pgrep -af 'ngrok|discovery_service|orchestrator|shard_manager|petals.cli' || echo "all clear"

mkdir -p "$HOME/.blitzwing"
: > "$HOME/.blitzwing/discovery.out"
: > "$HOME/.blitzwing/shard_manager.out"
: > "$HOME/.blitzwing/orchestrator.out"
: > "$HOME/.blitzwing/ngrok.out"

echo "== discovery :9000 =="
export DISCOVERY_ADMIN_TOKEN="$DISCOVERY_TOKEN"
export DISCOVERY_DB_PATH="$DISCOVERY_DB"
nohup python -m uvicorn discovery_service.app:app --host 0.0.0.0 --port 9000 \
  > "$HOME/.blitzwing/discovery.out" 2>&1 &
for i in $(seq 1 30); do curl -sf http://127.0.0.1:9000/v1/mothers >/dev/null && break; sleep 1; done

echo "== ngrok =="
nohup "$HOME/bin/ngrok" start --all --config "$NGROK_CFG" --log=stdout \
  > "$HOME/.blitzwing/ngrok.out" 2>&1 &
for i in $(seq 1 30); do curl -sf http://127.0.0.1:4040/api/tunnels >/dev/null && break; sleep 1; done

DISCOVERY_URL="$(python - <<'PY'
import json, urllib.request
t=json.load(urllib.request.urlopen("http://127.0.0.1:4040/api/tunnels"))
for x in t["tunnels"]:
    if x["name"]=="discovery":
        print(x["public_url"]); break
PY
)"
ORCH_URL="$(python - <<'PY'
import json, urllib.request
t=json.load(urllib.request.urlopen("http://127.0.0.1:4040/api/tunnels"))
for x in t["tunnels"]:
    if x["name"]=="orchestrator":
        print(x["public_url"]); break
PY
)"
PETALS_TCP="$(python - <<'PY'
import json, urllib.request
t=json.load(urllib.request.urlopen("http://127.0.0.1:4040/api/tunnels"))
for x in t["tunnels"]:
    if x["name"]=="petals":
        print(x["public_url"]); break
PY
)"
NGROK_HOST="$(echo "$PETALS_TCP" | sed -E 's|tcp://([^:/]+):.*|\1|')"
NGROK_PORT="$(echo "$PETALS_TCP" | sed -E 's|tcp://[^:]+:([0-9]+).*|\1|')"
echo "DISCOVERY_URL=$DISCOVERY_URL"
echo "ORCH_URL=$ORCH_URL"
echo "PETALS_TCP=$PETALS_TCP"

echo "== shard manager mother 0:22 =="
export MODEL_NAME=TinyLlama/TinyLlama-1.1B-Chat-v1.0
unset PUBLIC_IP || true
export BLOCK_INDICES=0:22
export NEW_SWARM=1
export IDENTITY_PATH="$HOME/.blitzwing/petals-identity-mother"
export PETALS_PORT=31337
export PETALS_DEVICE=cpu
export PETALS_QUANT_TYPE=none
export PETALS_PYTHON="$HOME/.blitzwing-venv/bin/python"
export SHARD_AUTO_START=1
export ANNOUNCE_MADDRS="/ip4/127.0.0.1/tcp/31337,/dns4/${NGROK_HOST}/tcp/${NGROK_PORT}"

nohup python -m uvicorn shard_manager.app:app --host 0.0.0.0 --port 8001 \
  > "$HOME/.blitzwing/shard_manager.out" 2>&1 &
for i in $(seq 1 120); do
  grep -q "\[INFO\] Started" "$HOME/.blitzwing/shard_manager.out" 2>/dev/null && break
  sleep 2
done
grep "Running a server" "$HOME/.blitzwing/shard_manager.out" | tail -n1
grep "Started" "$HOME/.blitzwing/shard_manager.out" | tail -n1

echo "== orchestrator :8000 =="
export TOTAL_LAYERS=22
export INITIAL_PEERS="/ip4/127.0.0.1/tcp/31337/p2p/$PEER"
export ANNOUNCE_PEERS="/dns4/${NGROK_HOST}/tcp/${NGROK_PORT}/p2p/$PEER"
export MOTHER_SHARD_MANAGER_URL=http://127.0.0.1:8001
export LOAD_AT_STARTUP=0

nohup python -m uvicorn orchestrator.app.main:app --host 0.0.0.0 --port 8000 \
  > "$HOME/.blitzwing/orchestrator.out" 2>&1 &
for i in $(seq 1 30); do curl -sf http://127.0.0.1:8000/health >/dev/null && break; sleep 1; done

echo "== register mother in discovery =="
curl -sf -X PUT "http://127.0.0.1:9000/v1/mothers/TinyLlama%2FTinyLlama-1.1B-Chat-v1.0" \
  -H "Authorization: Bearer $DISCOVERY_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"mother_url\":\"$ORCH_URL\"}" >/dev/null

curl -s http://127.0.0.1:8000/health; echo
curl -s http://127.0.0.1:9000/v1/mothers; echo
echo "RESTART_OK discovery=$DISCOVERY_URL orchestrator=$ORCH_URL petals=$PETALS_TCP"
