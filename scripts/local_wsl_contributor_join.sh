#!/usr/bin/env bash
# Second node on same machine (WSL). Petals does not run natively on Windows.
set -euo pipefail
source "$HOME/.blitzwing-venv/bin/activate"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
export PYTHONPATH="$ROOT"

MOTHER_URL="${MOTHER_URL:-http://127.0.0.1:8000}"
LAYERS="${BLITZWING_LAYERS:-8}"
SHARD_PORT="${BLITZWING_SHARD_PORT:-8011}"
PETALS_PORT="${BLITZWING_PETALS_PORT:-31338}"
HOST_IP="${WSL_HOST_IP:-$(hostname -I | awk '{print $1}')}"
HEDERA_ACCOUNT_ID="${BLITZWING_HEDERA_ACCOUNT_ID:-${HEDERA_ACCOUNT_ID:-}}"
LOG_DIR="$HOME/.blitzwing"
mkdir -p "$LOG_DIR"

echo "== contributor join =="
echo "mother=$MOTHER_URL host_ip=$HOST_IP shard=$SHARD_PORT petals=$PETALS_PORT layers=$LAYERS"

if [[ -z "$HEDERA_ACCOUNT_ID" || ! "$HEDERA_ACCOUNT_ID" =~ ^0\.0\.[0-9]+$ ]]; then
  echo "Set BLITZWING_HEDERA_ACCOUNT_ID (or HEDERA_ACCOUNT_ID) to a Hedera account like 0.0.123456"
  exit 1
fi

# Ensure mother is up before join
for i in $(seq 1 30); do
  curl -sf "$MOTHER_URL/health" >/dev/null && break
  sleep 1
done
curl -sf "http://127.0.0.1:8001/status" | grep -qE '"running":\s*true' || {
  echo "Mother Petals not running on :8001"; exit 1;
}

ASSIGNMENT=$(curl -sf -X POST "$MOTHER_URL/v1/hosts/join" \
  -H "Content-Type: application/json" \
  -d "{\"model\":\"TinyLlama/TinyLlama-1.1B-Chat-v1.0\",\"layers\":$LAYERS,\"public_ip\":\"$HOST_IP\",\"shard_manager_url\":\"http://$HOST_IP:$SHARD_PORT\",\"hedera_account_id\":\"$HEDERA_ACCOUNT_ID\"}")

HOST_ID=$(python3 -c "import json,sys; d=json.load(sys.stdin); print(d['host_id'])" <<<"$ASSIGNMENT")
BLOCKS=$(python3 -c "import json,sys; d=json.load(sys.stdin); print(d['block_indices'])" <<<"$ASSIGNMENT")
PEERS=$(python3 -c "import json,sys; d=json.load(sys.stdin); print(','.join(d.get('initial_peers',[])))" <<<"$ASSIGNMENT")
echo "assigned $BLOCKS host_id=$HOST_ID"

fuser -k "${SHARD_PORT}/tcp" "${PETALS_PORT}/tcp" 2>/dev/null || true
pkill -f "uvicorn shard_manager.app:app --host 0.0.0.0 --port ${SHARD_PORT}" 2>/dev/null || true
sleep 1

export MODEL_NAME=TinyLlama/TinyLlama-1.1B-Chat-v1.0
export PUBLIC_IP="$HOST_IP"
export BLOCK_INDICES="$BLOCKS"
export INITIAL_PEERS="$PEERS"
export PETALS_PORT="$PETALS_PORT"
export IDENTITY_PATH="$LOG_DIR/petals-identity-contributor"
export PETALS_PYTHON="$HOME/.blitzwing-venv/bin/python"
export SHARD_AUTO_START=1
export ANNOUNCE_MADDRS="/ip4/${HOST_IP}/tcp/${PETALS_PORT}"

: > "$LOG_DIR/contrib_shard.out"

nohup python -m uvicorn shard_manager.app:app --host 0.0.0.0 --port "$SHARD_PORT" \
  > "$LOG_DIR/contrib_shard.out" 2>&1 &
echo "shard manager pid=$! port=$SHARD_PORT"

echo "waiting for contributor Petals to announce blocks (CPU load may take minutes)…"
PEER_MADDR=""
for i in $(seq 1 180); do
  if grep -q "Running a server on" "$LOG_DIR/contrib_shard.out" 2>/dev/null; then
    PEER_MADDR=$(grep -oP "Running a server on \['([^']+)'\]" "$LOG_DIR/contrib_shard.out" | head -1 | sed "s/Running a server on \['//;s/'\]//")
    echo "contributor peer: $PEER_MADDR"
    break
  fi
  if grep -qE "ModuleNotFoundError|Traceback|P2PDaemonError" "$LOG_DIR/contrib_shard.out" 2>/dev/null; then
    echo "== contrib_shard.out tail =="
    tail -n 25 "$LOG_DIR/contrib_shard.out"
    exit 1
  fi
  sleep 5
done

if [ -z "$PEER_MADDR" ]; then
  echo "Timed out waiting for contributor Petals"
  tail -n 30 "$LOG_DIR/contrib_shard.out" || true
  exit 1
fi

curl -sf -X POST "$MOTHER_URL/v1/hosts/ready" \
  -H "Content-Type: application/json" \
  -d "{\"host_id\":\"$HOST_ID\",\"peer_multiaddr\":\"$PEER_MADDR\"}" >/dev/null

echo "waiting for mother reload to 0:$((22-LAYERS))…"
for i in $(seq 1 120); do
  MOTHER_BLOCKS=$(curl -sf "http://127.0.0.1:8001/status" | python3 -c "import json,sys; print(json.load(sys.stdin).get('block_indices',''))")
  if [ "$MOTHER_BLOCKS" = "0:$((22-LAYERS))" ]; then
    grep -q "Loaded TinyLlama.*block $((22-LAYERS-1))" "$LOG_DIR/shard_manager.out" 2>/dev/null && break
  fi
  sleep 3
done
sleep 5

echo "JOIN_OK $BLOCKS host_id=$HOST_ID peer=$PEER_MADDR"
curl -sf "$MOTHER_URL/v1/hosts"; echo
