#!/usr/bin/env bash
# Join the discovery GCP VM as a Petals contributor (public IP — no ngrok).
set -euo pipefail

ROOT="${HOME}/blitzwing"
MOTHER_URL="${MOTHER_URL:-http://136.65.225.87:8000}"
LAYERS="${BLITZWING_LAYERS:-4}"
SHARD_PORT="${BLITZWING_SHARD_PORT:-8011}"
PETALS_PORT="${BLITZWING_PETALS_PORT:-31337}"
HEDERA_ACCOUNT_ID="${BLITZWING_HEDERA_ACCOUNT_ID:-0.0.6111100}"
LOG_DIR="${HOME}/blitzwing-logs"
mkdir -p "$LOG_DIR"

PUBLIC_IP="${PUBLIC_IP:-$(curl -s --max-time 10 ifconfig.me)}"
HOST_IP="$(hostname -I | awk '{print $1}')"

# Petals/hivemind need Python 3.11 (same as mother VM). Avoid 3.13 on fresh Debian images.
PYTHON_BIN="${PYTHON_BIN:-}"
for candidate in python3.11 python3.12; do
  if command -v "$candidate" >/dev/null 2>&1; then
    PYTHON_BIN="$candidate"
    break
  fi
done
if [[ -z "$PYTHON_BIN" ]]; then
  echo "== installing Python 3.11 =="
  sudo apt-get update -y
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y python3.11 python3.11-venv python3.11-dev build-essential git
  PYTHON_BIN=python3.11
fi
PY="${HOME}/venv/bin/python"

echo "== GCP contributor (public IP) =="
echo "mother=$MOTHER_URL public_ip=$PUBLIC_IP layers=$LAYERS petals_port=$PETALS_PORT"

cd "$ROOT"
git fetch origin
git reset --hard origin/main

if [[ ! -x "$PY" ]]; then
  echo "== installing Python venv + Petals (first run) with $PYTHON_BIN =="
  rm -rf "${HOME}/venv"
  "$PYTHON_BIN" -m venv "${HOME}/venv"
  # shellcheck disable=SC1091
  source "${HOME}/venv/bin/activate"
  pip install -U pip wheel setuptools
  pip install torch --index-url https://download.pytorch.org/whl/cpu
  pip install -e "${ROOT}/petals"
  pip install -r "${ROOT}/shard_manager/requirements.txt"
  pip install -r "${ROOT}/orchestrator/requirements.txt"
fi

export PYTHONPATH="$ROOT"

# Cleanup stale contributor processes on this VM
pkill -f "uvicorn shard_manager.app:app --host 0.0.0.0 --port ${SHARD_PORT}" 2>/dev/null || true
pkill -f "petals.cli.run_server" 2>/dev/null || true
fuser -k "${SHARD_PORT}/tcp" "${PETALS_PORT}/tcp" 2>/dev/null || true
sleep 2

curl -sf "$MOTHER_URL/health" >/dev/null
echo "hosts before:"
curl -sf "$MOTHER_URL/v1/hosts" | python3 -m json.tool

ASSIGNMENT="$(curl -sf -X POST "$MOTHER_URL/v1/hosts/join" \
  -H "Content-Type: application/json" \
  -d "{\"model\":\"TinyLlama/TinyLlama-1.1B-Chat-v1.0\",\"layers\":${LAYERS},\"public_ip\":\"${PUBLIC_IP}\",\"shard_manager_url\":\"http://${HOST_IP}:${SHARD_PORT}\",\"hedera_account_id\":\"${HEDERA_ACCOUNT_ID}\"}")"
echo "$ASSIGNMENT" | python3 -m json.tool
HOST_ID="$(python3 -c 'import json,sys; print(json.load(sys.stdin)["host_id"])' <<<"$ASSIGNMENT")"
BLOCKS="$(python3 -c 'import json,sys; print(json.load(sys.stdin)["block_indices"])' <<<"$ASSIGNMENT")"
PEERS="$(python3 -c 'import json,sys; print(",".join(json.load(sys.stdin).get("initial_peers",[])))' <<<"$ASSIGNMENT")"

export MODEL_NAME=TinyLlama/TinyLlama-1.1B-Chat-v1.0
export PUBLIC_IP
export BLOCK_INDICES="$BLOCKS"
export INITIAL_PEERS="$PEERS"
export PETALS_PORT
export IDENTITY_PATH="${HOME}/.blitzwing/petals-identity-contributor"
export PETALS_PYTHON="$PY"
export SHARD_AUTO_START=1
export ANNOUNCE_MADDRS="/ip4/${PUBLIC_IP}/tcp/${PETALS_PORT}"
export PETALS_USE_AUTO_RELAY=0
export PETALS_SKIP_REACHABILITY_CHECK=1
export PETALS_DEVICE=cpu
export PETALS_QUANT_TYPE=none

: > "${LOG_DIR}/contrib_shard.out"
nohup "$PY" -m uvicorn shard_manager.app:app --host 0.0.0.0 --port "$SHARD_PORT" \
  > "${LOG_DIR}/contrib_shard.out" 2>&1 &
echo "shard_pid=$! blocks=$BLOCKS announce=$ANNOUNCE_MADDRS"

echo "== waiting for Petals blocks =="
for i in $(seq 1 300); do
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
grep -E "Running a server|Loaded|Started" "${LOG_DIR}/contrib_shard.out" | tail -n 8

PEER_MADDR="$(grep -oE "/ip4/${PUBLIC_IP}/tcp/${PETALS_PORT}/p2p/[A-Za-z0-9]+" "${LOG_DIR}/contrib_shard.out" | head -1 || true)"
if [[ -z "$PEER_MADDR" ]]; then
  P2P="$(grep -oE 'p2p/[A-Za-z0-9]+' "${LOG_DIR}/contrib_shard.out" | tail -1 | cut -d/ -f2)"
  PEER_MADDR="/ip4/${PUBLIC_IP}/tcp/${PETALS_PORT}/p2p/${P2P}"
fi
echo "PEER_MADDR=$PEER_MADDR"

echo "== verify TCP ${PUBLIC_IP}:${PETALS_PORT} from this host =="
ss -lntp | grep ":${PETALS_PORT}" || true

echo "waiting 30s for DHT propagation..."
sleep 30

echo "== ready =="
python3 - "$HOST_ID" "$PEER_MADDR" "$MOTHER_URL" <<'PY'
import json, sys, urllib.request, urllib.error
host_id, peer, mother = sys.argv[1], sys.argv[2], sys.argv[3]
payload = {"host_id": host_id, "peer_multiaddr": peer}
body = json.dumps(payload).encode()
req = urllib.request.Request(
    f"{mother}/v1/hosts/ready",
    data=body,
    headers={"Content-Type": "application/json"},
    method="POST",
)
try:
    with urllib.request.urlopen(req, timeout=180) as r:
        print("READY_STATUS", r.status)
        print(r.read().decode())
except urllib.error.HTTPError as e:
    print("READY_STATUS", e.code)
    print(e.read().decode())
    raise SystemExit(1)
PY

nohup bash -c "while true; do curl -sf -X POST '${MOTHER_URL}/v1/hosts/heartbeat' -H 'Content-Type: application/json' -d '{\"host_id\":\"${HOST_ID}\"}' >/dev/null || true; sleep 60; done" \
  > "${LOG_DIR}/contrib_heartbeat.out" 2>&1 &

echo "== hosts after ready =="
curl -sf "$MOTHER_URL/v1/hosts" | python3 -m json.tool
echo "GCP_CONTRIB_OK host_id=${HOST_ID} peer=${PEER_MADDR}"
