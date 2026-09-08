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
    with urllib.request.urlopen(req, timeout=180) as r:
        print(r.read().decode())
except urllib.error.HTTPError as e:
    print(e.read().decode(), file=sys.stderr)
    sys.exit(e.code)
PY
}

echo "== cleanup stale contributor =="
fuser -k "${SHARD_PORT}/tcp" "${PETALS_PORT}/tcp" 2>/dev/null || true
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

echo "== join $LAYERS layers =="
ASSIGNMENT="$(api POST "${MOTHER_URL}/v1/hosts/join" "{\"model\":\"TinyLlama/TinyLlama-1.1B-Chat-v1.0\",\"layers\":${LAYERS},\"public_ip\":\"${HOST_IP}\",\"shard_manager_url\":\"http://${HOST_IP}:${SHARD_PORT}\",\"hedera_account_id\":\"${HEDERA_ACCOUNT_ID}\"}")"
echo "$ASSIGNMENT" | python3 -m json.tool
HOST_ID="$(python3 -c 'import json,sys; print(json.load(sys.stdin)["host_id"])' <<<"$ASSIGNMENT")"
BLOCKS="$(python3 -c 'import json,sys; print(json.load(sys.stdin)["block_indices"])' <<<"$ASSIGNMENT")"
PEERS="$(python3 -c 'import json,sys; print(",".join(json.load(sys.stdin).get("initial_peers",[])))' <<<"$ASSIGNMENT")"

# ngrok optional — use if already running on :4040
ANNOUNCE_MADDRS=""
if curl -sf http://127.0.0.1:4040/api/tunnels >/dev/null 2>&1; then
  ANNOUNCE_MADDRS="$(python3 -c '
import json, urllib.request
from urllib.parse import urlparse
d = json.load(urllib.request.urlopen("http://127.0.0.1:4040/api/tunnels"))
t = next((x for x in d.get("tunnels", []) if x.get("proto") == "tcp"), None)
if not t:
    raise SystemExit(1)
u = urlparse(t["public_url"])
print(f"/dns4/{u.hostname}/tcp/{u.port}")
' 2>/dev/null || true)"
  echo "ngrok announce=$ANNOUNCE_MADDRS"
fi

USE_AUTO_RELAY=1
if [[ -n "$ANNOUNCE_MADDRS" ]]; then
  USE_AUTO_RELAY=0
fi

export MODEL_NAME=TinyLlama/TinyLlama-1.1B-Chat-v1.0
export PUBLIC_IP="$HOST_IP"
export BLOCK_INDICES="$BLOCKS"
export INITIAL_PEERS="$PEERS"
export PETALS_PORT
export IDENTITY_PATH="${LOG_DIR}/petals-identity-contributor"
export PETALS_PYTHON="${HOME}/.blitzwing-venv/bin/python"
export SHARD_AUTO_START=1
export PETALS_USE_AUTO_RELAY="$USE_AUTO_RELAY"
export PETALS_SKIP_REACHABILITY_CHECK=1
export PETALS_DEVICE=cpu
export PETALS_QUANT_TYPE=none
unset ANNOUNCE_MADDRS || true
if [[ -n "${ANNOUNCE_MADDRS:-}" ]]; then
  export ANNOUNCE_MADDRS
fi

: > "${LOG_DIR}/contrib_shard.out"
nohup python -m uvicorn shard_manager.app:app --host 0.0.0.0 --port "$SHARD_PORT" \
  > "${LOG_DIR}/contrib_shard.out" 2>&1 &
echo "shard_pid=$! blocks=$BLOCKS relay=$USE_AUTO_RELAY"

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

echo "waiting 45s for DHT block announcements…"
sleep 45

PEER_MADDR=""
if [[ -n "${ANNOUNCE_MADDRS:-}" ]]; then
  P2P="$(grep -oE 'p2p/[A-Za-z0-9]+' "${LOG_DIR}/contrib_shard.out" | head -1 | cut -d/ -f2)"
  PEER_MADDR="${ANNOUNCE_MADDRS}/p2p/${P2P}"
else
  PEER_MADDR="$(grep -oE '/ip[46]/[^ ]+/p2p/[A-Za-z0-9]+' "${LOG_DIR}/contrib_shard.out" | grep -v '127.0.0.1' | head -1 || true)"
fi
echo "PEER_MADDR=${PEER_MADDR:-<none>}"

READY_BODY="{\"host_id\":\"${HOST_ID}\""
if [[ -n "$PEER_MADDR" && "$PEER_MADDR" != *"172."* && "$PEER_MADDR" != *"192.168."* ]]; then
  READY_BODY+=",\"peer_multiaddr\":\"${PEER_MADDR}\""
fi
READY_BODY+="}"

echo "== ready handoff =="
READY_OUT="$(api POST "${MOTHER_URL}/v1/hosts/ready" "$READY_BODY")"
echo "$READY_OUT" | python3 -m json.tool

nohup bash -c "while true; do curl -sf -X POST '${MOTHER_URL}/v1/hosts/heartbeat' -H 'Content-Type: application/json' -d '{\"host_id\":\"${HOST_ID}\"}' >/dev/null || true; sleep 60; done" \
  > "${LOG_DIR}/contrib_heartbeat.out" 2>&1 &

echo "== hosts after ready =="
api GET "${MOTHER_URL}/v1/hosts" | python3 -m json.tool
echo "JOIN_OK host_id=${HOST_ID} blocks=${BLOCKS}"
