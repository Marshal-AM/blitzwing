#!/usr/bin/env bash
# Join WSL contributor to GCP mother — auto-relay (default) or ngrok if running.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
[[ -f "$ROOT/shard_manager/app.py" ]] || ROOT=/mnt/c/Users/MSI/Desktop/blitzwing
cd "$ROOT"
# shellcheck disable=SC1091
source "${HOME}/.blitzwing-venv/bin/activate"
export PYTHONPATH="$ROOT"

MOTHER_URL="${MOTHER_URL:-http://136.65.225.87:8000}"
LAYERS="${BLITZWING_LAYERS:-4}"
SHARD_PORT="${BLITZWING_SHARD_PORT:-8011}"
PETALS_PORT="${BLITZWING_PETALS_PORT:-31338}"
HOST_IP="${WSL_HOST_IP:-$(hostname -I | awk '{print $1}')}"
HEDERA_ACCOUNT_ID="${BLITZWING_HEDERA_ACCOUNT_ID:-0.0.6111100}"
LOG_DIR="${HOME}/.blitzwing"
mkdir -p "$LOG_DIR"

api() {
  python3 - "$@" <<'PY'
import json, sys, urllib.request, urllib.error
method, url, body = sys.argv[1], sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else ""
req = urllib.request.Request(
    url,
    data=body.encode() if body else None,
    headers={"Content-Type": "application/json"} if body else {},
    method=method,
)
try:
    with urllib.request.urlopen(req, timeout=300) as r:
        print(r.read().decode())
except urllib.error.HTTPError as e:
    print(e.read().decode(), file=sys.stderr)
    sys.exit(e.code)
PY
}

echo "== cleanup stale contributor =="
pkill -9 -x ngrok 2>/dev/null || true
pkill -9 -f 'ngrok tcp' 2>/dev/null || true
fuser -k "${SHARD_PORT}/tcp" "${PETALS_PORT}/tcp" 4040/tcp 2>/dev/null || true
pkill -f "uvicorn shard_manager.app:app --host 0.0.0.0 --port ${SHARD_PORT}" 2>/dev/null || true
pkill -f "petals.cli.run_server.*${PETALS_PORT}" 2>/dev/null || true
sleep 2

# Leave any pending contributors from prior runs
HOSTS_JSON="$(api GET "${MOTHER_URL}/v1/hosts" || echo '{}')"
python3 -c '
import json, sys, urllib.request
mother = sys.argv[1]
data = json.loads(sys.argv[2])
for h in data.get("hosts", []):
    if h.get("role") == "contributor" and h.get("status") in ("pending", "online"):
        hid = h["host_id"]
        body = json.dumps({"host_id": hid}).encode()
        req = urllib.request.Request(
            mother.rstrip("/") + "/v1/hosts/leave",
            data=body,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            urllib.request.urlopen(req, timeout=30)
            print("left", hid)
        except Exception as exc:
            print("leave failed", hid, exc)
' "$MOTHER_URL" "$HOSTS_JSON" || true

# ngrok HTTP tunnel for shard manager — mother POSTs inference here (simple, reliable).
SHARD_PUBLIC_URL="http://${HOST_IP}:${SHARD_PORT}"
if [[ "${BLITZWING_USE_NGROK_HTTP:-1}" == "1" ]]; then
  NGROK_BIN=""
  if command -v ngrok >/dev/null 2>&1; then
    NGROK_BIN="ngrok"
  elif [[ -x "${HOME}/bin/ngrok" ]]; then
    NGROK_BIN="${HOME}/bin/ngrok"
  fi
  if [[ -n "$NGROK_BIN" ]]; then
    if ! curl -sf http://127.0.0.1:4040/api/tunnels >/dev/null 2>&1; then
      echo "starting ngrok http ${SHARD_PORT}…"
      setsid "$NGROK_BIN" http "${SHARD_PORT}" --log=stdout > "${LOG_DIR}/ngrok_http.out" 2>&1 < /dev/null &
      sleep 5
    fi
    SHARD_PUBLIC_URL="$(python3 -c '
import json, urllib.request
d = json.load(urllib.request.urlopen("http://127.0.0.1:4040/api/tunnels"))
t = next((x for x in d.get("tunnels", []) if x.get("proto") == "https"), None)
if not t:
    t = next((x for x in d.get("tunnels", []) if x.get("proto") == "http"), None)
if not t:
    raise SystemExit(1)
print(t["public_url"].rstrip("/"))
' 2>/dev/null || true)"
    echo "shard_public_url=${SHARD_PUBLIC_URL}"
  fi
fi

echo "== join $LAYERS layers =="
MODEL="${MODEL_NAME:-bigscience/bloom-560m}"
ASSIGNMENT="$(api POST "${MOTHER_URL}/v1/hosts/join" "{\"model\":\"${MODEL}\",\"layers\":${LAYERS},\"public_ip\":\"${HOST_IP}\",\"shard_manager_url\":\"${SHARD_PUBLIC_URL}\",\"hedera_account_id\":\"${HEDERA_ACCOUNT_ID}\"}")"
echo "$ASSIGNMENT" | python3 -m json.tool
HOST_ID="$(python3 -c 'import json,sys; print(json.load(sys.stdin)["host_id"])' <<<"$ASSIGNMENT")"
BLOCKS="$(python3 -c 'import json,sys; print(json.load(sys.stdin)["block_indices"])' <<<"$ASSIGNMENT")"
PEERS="$(python3 -c 'import json,sys; print(",".join(json.load(sys.stdin).get("initial_peers",[])))' <<<"$ASSIGNMENT")"

# Petals uses auto-relay for DHT; inference goes over HTTP to shard_manager (above).
USE_AUTO_RELAY=1
SAVED_ANNOUNCE=""

export MODEL_NAME="${MODEL_NAME:-bigscience/bloom-560m}"
export PUBLIC_IP="$HOST_IP"
export BLOCK_INDICES="$BLOCKS"
# HTTP-only mode: local Petals server does NOT bootstrap to mother via libp2p.
# Cross-node inference uses HTTP chain (mother prefix + contributor tail).
export NEW_SWARM=1
export INITIAL_PEERS=""
export PETALS_PORT
export IDENTITY_PATH="${LOG_DIR}/petals-identity-contributor"
export PETALS_PYTHON="${HOME}/.blitzwing-venv/bin/python"
export SHARD_AUTO_START=1
export PETALS_USE_AUTO_RELAY=0
export PETALS_SKIP_REACHABILITY_CHECK=1
export BLITZWING_HTTP_ONLY=1
export PETALS_DEVICE=cpu
export PETALS_QUANT_TYPE=none
export BLITZWING_HOST_ID="$HOST_ID"
export BLITZWING_MOTHER_URL="$MOTHER_URL"
export HEARTBEAT_INTERVAL_SECONDS=20
export CONTRIB_SHARD_LOG="${LOG_DIR}/contrib_shard.out"
export BLITZWING_SHARD_MANAGER_URL="${SHARD_PUBLIC_URL}"

: > "${LOG_DIR}/contrib_shard.out"
nohup python -m uvicorn shard_manager.app:app --host 0.0.0.0 --port "$SHARD_PORT" \
  > "${LOG_DIR}/contrib_shard.out" 2>&1 &
echo "shard_pid=$! blocks=$BLOCKS http=${SHARD_PUBLIC_URL}"

for i in $(seq 1 180); do
  if grep -q "Running a server on" "${LOG_DIR}/contrib_shard.out" 2>/dev/null; then
    echo "Petals up after $((i * 5))s"
    grep -E "Running a server|relay|accessible" "${LOG_DIR}/contrib_shard.out" | tail -n 10
    break
  fi
  if grep -qE "ModuleNotFoundError|Traceback|P2PDaemonError" "${LOG_DIR}/contrib_shard.out" 2>/dev/null; then
    tail -n 50 "${LOG_DIR}/contrib_shard.out"
    exit 1
  fi
  sleep 5
done
grep -q "Running a server on" "${LOG_DIR}/contrib_shard.out" || { tail -n 40 "${LOG_DIR}/contrib_shard.out"; exit 1; }

echo "waiting 20s for DHT block announcements + inference warm-up…"
sleep 20

PEER_MADDR=""
echo "PEER_MADDR=${PEER_MADDR:-<none>} (inference uses HTTP ${SHARD_PUBLIC_URL})"

READY_BODY="{\"host_id\":\"${HOST_ID}\""
if [[ -n "$PEER_MADDR" ]]; then
  READY_BODY+=",\"peer_multiaddr\":\"${PEER_MADDR}\""
fi
READY_BODY+="}"

echo "== ready handoff =="
READY_OUT="$(api POST "${MOTHER_URL}/v1/hosts/ready" "$READY_BODY")"
echo "$READY_OUT" | python3 -m json.tool

nohup bash -c "while true; do curl -sf -X POST '${MOTHER_URL}/v1/hosts/heartbeat' -H 'Content-Type: application/json' -d '{\"host_id\":\"${HOST_ID}\"}' >/dev/null || true; sleep 20; done" \
  > "${LOG_DIR}/contrib_heartbeat.out" 2>&1 &

echo "== hosts after ready =="
api GET "${MOTHER_URL}/v1/hosts" | python3 -m json.tool
echo "JOIN_OK host_id=${HOST_ID} blocks=${BLOCKS}"
