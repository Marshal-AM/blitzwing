#!/usr/bin/env bash
# Full WSL E2E: cleanup → ngrok contributor join → paid chat probe.
set -euo pipefail

ROOT="/mnt/c/Users/MSI/Desktop/blitzwing"
MOTHER_URL="${MOTHER_URL:-http://136.65.225.87:8000}"
LAYERS="${BLITZWING_LAYERS:-4}"
SHARD_PORT="${BLITZWING_SHARD_PORT:-8011}"
PETALS_PORT="${BLITZWING_PETALS_PORT:-31338}"
HEDERA_ACCOUNT_ID="${BLITZWING_HEDERA_ACCOUNT_ID:-0.0.6111100}"
LOG_DIR="${HOME}/.blitzwing"
mkdir -p "$LOG_DIR"

source "${HOME}/.blitzwing-venv/bin/activate"
export PYTHONPATH="$ROOT"

echo "== 1. cleanup stale contributor/ngrok =="
pkill -f 'uvicorn shard_manager.app:app --host 0.0.0.0 --port 8011' 2>/dev/null || true
pkill -f 'petals.cli.run_server.*18:22' 2>/dev/null || true
pkill -x ngrok 2>/dev/null || true
fuser -k "${SHARD_PORT}/tcp" "${PETALS_PORT}/tcp" 2>/dev/null || true
sleep 3

# Release any stuck pending hosts from this machine
for hid in host-d7beff8c97b9 host-9ce052d6b1d1 host-95484cc4eade; do
  curl -sf -X POST "$MOTHER_URL/v1/hosts/leave" \
    -H "Content-Type: application/json" \
    -d "{\"host_id\":\"$hid\"}" >/dev/null 2>&1 || true
done

echo "== 2. start ngrok TCP for Petals =="
if [[ ! -x "${HOME}/bin/ngrok" ]]; then
  NGROK_BIN="$(command -v ngrok || true)"
else
  NGROK_BIN="${HOME}/bin/ngrok"
fi
[[ -n "$NGROK_BIN" ]] || { echo "ngrok not found"; exit 1; }
setsid "$NGROK_BIN" tcp "$PETALS_PORT" --log=stdout > "$LOG_DIR/ngrok_contrib.out" 2>&1 < /dev/null &
sleep 5
TUNNEL_JSON="$(curl -sf http://127.0.0.1:4040/api/tunnels)"
PUBLIC_URL="$(python3 -c 'import json,sys; d=json.load(sys.stdin); t=next((x for x in d.get("tunnels",[]) if x.get("proto")=="tcp"), None); print(t["public_url"] if t else "")' <<<"$TUNNEL_JSON")"
[[ -n "$PUBLIC_URL" ]] || { echo "no ngrok tunnel"; cat "$LOG_DIR/ngrok_contrib.out"; exit 1; }
NGROK_HOST="$(python3 -c 'from urllib.parse import urlparse; import sys; u=urlparse(sys.argv[1]); print(u.hostname)' "$PUBLIC_URL")"
NGROK_PORT="$(python3 -c 'from urllib.parse import urlparse; import sys; u=urlparse(sys.argv[1]); print(u.port)' "$PUBLIC_URL")"
ANNOUNCE="/dns4/${NGROK_HOST}/tcp/${NGROK_PORT}"
echo "ngrok announce=$ANNOUNCE"

echo "== 3. join =="
HOST_IP="$(hostname -I | awk '{print $1}')"
ASSIGNMENT="$(curl -sf -X POST "$MOTHER_URL/v1/hosts/join" \
  -H "Content-Type: application/json" \
  -d "{\"model\":\"TinyLlama/TinyLlama-1.1B-Chat-v1.0\",\"layers\":${LAYERS},\"public_ip\":\"${NGROK_HOST}\",\"shard_manager_url\":\"http://${HOST_IP}:${SHARD_PORT}\",\"hedera_account_id\":\"${HEDERA_ACCOUNT_ID}\"}")"
echo "$ASSIGNMENT" | python3 -m json.tool
HOST_ID="$(python3 -c 'import json,sys; print(json.load(sys.stdin)["host_id"])' <<<"$ASSIGNMENT")"
BLOCKS="$(python3 -c 'import json,sys; print(json.load(sys.stdin)["block_indices"])' <<<"$ASSIGNMENT")"
PEERS="$(python3 -c 'import json,sys; print(",".join(json.load(sys.stdin).get("initial_peers",[])))' <<<"$ASSIGNMENT")"

export MODEL_NAME=TinyLlama/TinyLlama-1.1B-Chat-v1.0
export PUBLIC_IP="$NGROK_HOST"
export BLOCK_INDICES="$BLOCKS"
export INITIAL_PEERS="$PEERS"
export PETALS_PORT
export IDENTITY_PATH="${LOG_DIR}/petals-identity-contributor"
export PETALS_PYTHON="${HOME}/.blitzwing-venv/bin/python"
export SHARD_AUTO_START=1
export ANNOUNCE_MADDRS="$ANNOUNCE"
export PETALS_USE_AUTO_RELAY=0
export PETALS_DEVICE=cpu
export PETALS_QUANT_TYPE=none

: > "${LOG_DIR}/contrib_shard.out"
nohup python -m uvicorn shard_manager.app:app --host 0.0.0.0 --port "$SHARD_PORT" \
  > "${LOG_DIR}/contrib_shard.out" 2>&1 &
echo "shard_pid=$! blocks=$BLOCKS"

echo "== 4. wait for Petals blocks loaded =="
for i in $(seq 1 300); do
  STATUS="$(curl -sf "http://127.0.0.1:${SHARD_PORT}/status" 2>/dev/null || true)"
  if [[ -n "$STATUS" ]]; then
    EXIT_CODE="$(python3 -c 'import json,sys; d=json.loads(sys.argv[1]); print(d.get("last_exit_code") or "")' "$STATUS" 2>/dev/null || true)"
    if [[ -n "$EXIT_CODE" ]]; then
      echo "Petals exited with code ${EXIT_CODE}"
      tail -n 40 "${LOG_DIR}/contrib_shard.out"
      exit 1
    fi
  fi
  # Petals logs "Loaded <model> block N" then "[INFO] Started" when all blocks are ready.
  if grep -qE '\[INFO\] Started$|Loaded .+ block [0-9]+' "${LOG_DIR}/contrib_shard.out" 2>/dev/null; then
    echo "Petals loaded after $((i * 2))s"
    break
  fi
  if grep -qE "ModuleNotFoundError|Traceback|P2PDaemonError" "${LOG_DIR}/contrib_shard.out" 2>/dev/null; then
    tail -n 40 "${LOG_DIR}/contrib_shard.out"
    exit 1
  fi
  sleep 2
done
grep -qE '\[INFO\] Started$|Loaded .+ block [0-9]+' "${LOG_DIR}/contrib_shard.out" || {
  echo "Timed out waiting for Petals blocks"
  tail -n 40 "${LOG_DIR}/contrib_shard.out"
  exit 1
}
grep -E "Running a server|Loaded|Started" "${LOG_DIR}/contrib_shard.out" | tail -n 10

# Extra DHT propagation wait
echo "waiting 60s for DHT propagation..."
sleep 60

PEER_MADDR="$(grep -oE "${ANNOUNCE}/p2p/[A-Za-z0-9]+" "${LOG_DIR}/contrib_shard.out" | head -1 || true)"
echo "PEER_MADDR=${PEER_MADDR:-none}"

echo "== 5. ready (up to 150s) =="
python3 - "$HOST_ID" "$PEER_MADDR" "$MOTHER_URL" <<'PY'
import json, sys, urllib.request, urllib.error
host_id, peer, mother = sys.argv[1], sys.argv[2], sys.argv[3]
payload = {"host_id": host_id}
if peer:
    payload["peer_multiaddr"] = peer
body = json.dumps(payload).encode()
req = urllib.request.Request(
    f"{mother}/v1/hosts/ready",
    data=body,
    headers={"Content-Type": "application/json"},
    method="POST",
)
try:
    with urllib.request.urlopen(req, timeout=150) as r:
        print("READY_STATUS", r.status)
        print(r.read().decode())
except urllib.error.HTTPError as e:
    print("READY_STATUS", e.code)
    print(e.read().decode())
PY

nohup bash -c "while true; do curl -sf -X POST '${MOTHER_URL}/v1/hosts/heartbeat' -H 'Content-Type: application/json' -d '{\"host_id\":\"${HOST_ID}\"}' >/dev/null || true; sleep 60; done" \
  > "${LOG_DIR}/contrib_heartbeat.out" 2>&1 &

echo "== 6. hosts after ready =="
curl -sf "$MOTHER_URL/v1/hosts" | python3 -m json.tool

echo "== 7. paid chat client =="
cd "$ROOT/examples/x402_chat_client"
export BLITZWING_BASE_URL="${MOTHER_URL}/v1"
export BLITZWING_QUERY="Say hello in one short sentence."
npm start 2>&1 | tee "$LOG_DIR/paid_chat.out"
echo E2E_DONE
