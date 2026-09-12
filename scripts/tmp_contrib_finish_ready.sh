#!/usr/bin/env bash
set -euo pipefail
MOTHER_URL="${MOTHER_URL:-http://136.113.86.69:8000}"
LAYERS="${BLITZWING_LAYERS:-4}"
PUBLIC_IP="${PUBLIC_IP:-$(curl -s --max-time 10 ifconfig.me)}"
HOST_IP="$(hostname -I | awk '{print $1}')"
SHARD_PORT="${BLITZWING_SHARD_PORT:-8011}"
PETALS_PORT="${BLITZWING_PETALS_PORT:-31337}"
LOG_DIR="${HOME}/blitzwing-logs"

PEER_MADDR="$(grep -oE "/ip4/${PUBLIC_IP}/tcp/${PETALS_PORT}/p2p/[A-Za-z0-9]+" "${LOG_DIR}/contrib_shard.out" 2>/dev/null | head -1 || true)"
if [[ -z "${PEER_MADDR}" ]]; then
  P2P="$(grep -oE 'p2p/[A-Za-z0-9]+' "${LOG_DIR}/contrib_shard.out" | tail -1 | cut -d/ -f2)"
  PEER_MADDR="/ip4/${PUBLIC_IP}/tcp/${PETALS_PORT}/p2p/${P2P}"
fi
echo "PEER_MADDR=${PEER_MADDR}"

ASSIGNMENT="$(curl -sf -X POST "${MOTHER_URL}/v1/hosts/join" \
  -H "Content-Type: application/json" \
  -d "{\"model\":\"HuggingFaceTB/SmolLM2-360M-Instruct\",\"layers\":${LAYERS},\"public_ip\":\"${PUBLIC_IP}\",\"shard_manager_url\":\"http://${HOST_IP}:${SHARD_PORT}\",\"hedera_account_id\":\"0.0.6111100\"}")"
echo "${ASSIGNMENT}" | python3 -m json.tool
HOST_ID="$(python3 -c 'import json,sys; print(json.load(sys.stdin)["host_id"])' <<<"${ASSIGNMENT}")"

python3 - "${HOST_ID}" "${PEER_MADDR}" "${MOTHER_URL}" <<'PY'
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
with urllib.request.urlopen(req, timeout=180) as r:
    print("READY_STATUS", r.status)
    print(r.read().decode())
PY

pkill -f contrib_heartbeat.out 2>/dev/null || true
nohup bash -c "while true; do curl -sf -X POST '${MOTHER_URL}/v1/hosts/heartbeat' -H 'Content-Type: application/json' -d '{\"host_id\":\"${HOST_ID}\"}' >/dev/null || true; sleep 20; done" \
  > "${LOG_DIR}/contrib_heartbeat.out" 2>&1 &

echo "== hosts after ready =="
curl -sf "${MOTHER_URL}/v1/hosts" | python3 -m json.tool
echo "CONTRIB_READY_OK host_id=${HOST_ID}"
