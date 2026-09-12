#!/usr/bin/env bash
# Join a WSL contributor to the live GCP mother (needs public Petals reachability via ngrok).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# Prefer Linux checkout if present; fall back to Windows mount
if [[ ! -f "$ROOT/shard_manager/app.py" ]]; then
  ROOT=/mnt/c/Users/MSI/Desktop/blitzwing
fi
cd "$ROOT"
# shellcheck disable=SC1091
source "${HOME}/.blitzwing-venv/bin/activate"
export PYTHONPATH="$ROOT"

MOTHER_URL="${MOTHER_URL:-http://136.113.86.69:8000}"
LAYERS="${BLITZWING_LAYERS:-4}"
SHARD_PORT="${BLITZWING_SHARD_PORT:-8011}"
PETALS_PORT="${BLITZWING_PETALS_PORT:-31338}"
HOST_IP="${WSL_HOST_IP:-$(hostname -I | awk '{print $1}')}"
HEDERA_ACCOUNT_ID="${BLITZWING_HEDERA_ACCOUNT_ID:-0.0.6111100}"
LOG_DIR="${HOME}/.blitzwing"
mkdir -p "$LOG_DIR"

# Discover ngrok TCP tunnel for Petals
TUNNEL_JSON="$(curl -sf http://127.0.0.1:4040/api/tunnels)"
PUBLIC_URL="$(python3 -c 'import json,sys; d=json.load(sys.stdin); t=next((x for x in d.get("tunnels",[]) if x.get("proto")=="tcp"), None); print(t["public_url"] if t else "")' <<<"$TUNNEL_JSON")"
if [[ -z "$PUBLIC_URL" ]]; then
  echo "No ngrok TCP tunnel on :4040. Start: ngrok tcp ${PETALS_PORT}"
  exit 1
fi
# tcp://host:port
NGROK_HOST="$(python3 -c 'from urllib.parse import urlparse; import sys; u=urlparse(sys.argv[1]); print(u.hostname)' "$PUBLIC_URL")"
NGROK_PORT="$(python3 -c 'from urllib.parse import urlparse; import sys; u=urlparse(sys.argv[1]); print(u.port)' "$PUBLIC_URL")"
ANNOUNCE="/dns4/${NGROK_HOST}/tcp/${NGROK_PORT}"

echo "== contributor join =="
echo "mother=$MOTHER_URL layers=$LAYERS announce=$ANNOUNCE hedera=$HEDERA_ACCOUNT_ID"

curl -sf "$MOTHER_URL/health" >/dev/null
echo "hosts before:"
curl -sf "$MOTHER_URL/v1/hosts" | python3 -m json.tool

ASSIGNMENT="$(curl -sf -X POST "$MOTHER_URL/v1/hosts/join" \
  -H "Content-Type: application/json" \
  -d "{\"model\":\"HuggingFaceTB/SmolLM2-360M-Instruct\",\"layers\":${LAYERS},\"public_ip\":\"${NGROK_HOST}\",\"shard_manager_url\":\"http://${HOST_IP}:${SHARD_PORT}\",\"hedera_account_id\":\"${HEDERA_ACCOUNT_ID}\"}")"
echo "$ASSIGNMENT" | python3 -m json.tool
HOST_ID="$(python3 -c 'import json,sys; print(json.load(sys.stdin)["host_id"])' <<<"$ASSIGNMENT")"
BLOCKS="$(python3 -c 'import json,sys; print(json.load(sys.stdin)["block_indices"])' <<<"$ASSIGNMENT")"
PEERS="$(python3 -c 'import json,sys; print(",".join(json.load(sys.stdin).get("initial_peers",[])))' <<<"$ASSIGNMENT")"

fuser -k "${SHARD_PORT}/tcp" "${PETALS_PORT}/tcp" 2>/dev/null || true
pkill -f "uvicorn shard_manager.app:app --host 0.0.0.0 --port ${SHARD_PORT}" 2>/dev/null || true
sleep 2

export MODEL_NAME=HuggingFaceTB/SmolLM2-360M-Instruct
export PUBLIC_IP="$NGROK_HOST"
export BLOCK_INDICES="$BLOCKS"
export INITIAL_PEERS="$PEERS"
export PETALS_PORT
export IDENTITY_PATH="${LOG_DIR}/petals-identity-contributor"
export PETALS_PYTHON="${HOME}/.blitzwing-venv/bin/python"
export SHARD_AUTO_START=1
export ANNOUNCE_MADDRS="$ANNOUNCE"
export PETALS_USE_AUTO_RELAY=0
export PETALS_SKIP_REACHABILITY_CHECK=1
export PETALS_DEVICE=cpu
export PETALS_QUANT_TYPE=none

: > "${LOG_DIR}/contrib_shard.out"
nohup python -m uvicorn shard_manager.app:app --host 0.0.0.0 --port "$SHARD_PORT" \
  > "${LOG_DIR}/contrib_shard.out" 2>&1 &
echo "shard_pid=$! blocks=$BLOCKS"

echo "waiting for Petals to load blocks (CPU; can take several minutes)…"
for i in $(seq 1 180); do
  if grep -q "Running a server on" "${LOG_DIR}/contrib_shard.out" 2>/dev/null; then
    echo "Petals up after $((i * 5))s"
    grep -E "Running a server|Loaded|block" "${LOG_DIR}/contrib_shard.out" | tail -n 20
    break
  fi
  if grep -qE "ModuleNotFoundError|Traceback|P2PDaemonError" "${LOG_DIR}/contrib_shard.out" 2>/dev/null; then
    echo "Petals failed"
    tail -n 50 "${LOG_DIR}/contrib_shard.out"
    exit 1
  fi
  if (( i % 12 == 0 )); then
    echo "…still waiting $((i * 5))s"
    tail -n 3 "${LOG_DIR}/contrib_shard.out" || true
  fi
  sleep 5
done
grep -q "Running a server on" "${LOG_DIR}/contrib_shard.out" || {
  echo "Timed out waiting for Petals"
  tail -n 60 "${LOG_DIR}/contrib_shard.out"
  exit 1
}

# Prefer announce-line peer id (avoid matching mother's initial_peers Qm…).
PEER_MADDR="$(grep -oE "${ANNOUNCE}/p2p/[A-Za-z0-9]+" "${LOG_DIR}/contrib_shard.out" | head -1 || true)"
if [[ -z "$PEER_MADDR" ]]; then
  P2P="$(grep -oE 'Running a server on .*/p2p/[A-Za-z0-9]+' "${LOG_DIR}/contrib_shard.out" | head -1 | grep -oE 'p2p/[A-Za-z0-9]+' | cut -d/ -f2)"
  PEER_MADDR="${ANNOUNCE}/p2p/${P2P}"
fi
echo "PEER_MADDR=$PEER_MADDR"

echo "waiting 45s for DHT propagation..."
sleep 45

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

# Keep heartbeat so host stays online for payouts
nohup bash -c "while true; do curl -sf -X POST '${MOTHER_URL}/v1/hosts/heartbeat' -H 'Content-Type: application/json' -d '{\"host_id\":\"${HOST_ID}\"}' >/dev/null || true; sleep 20; done" \
  > "${LOG_DIR}/contrib_heartbeat.out" 2>&1 &

echo "== hosts after ready =="
curl -sf "$MOTHER_URL/v1/hosts" | python3 -m json.tool
echo "JOIN_OK host_id=${HOST_ID} blocks=${BLOCKS} peer=${PEER_MADDR}"
