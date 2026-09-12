#!/usr/bin/env bash
set -euo pipefail
MOTHER_URL="${MOTHER_URL:-http://136.113.86.69:8000}"
HOST_ID="${1:-host-ccc459bd6714}"
PEER="${2:-/dns4/0.tcp.in.ngrok.io/tcp/20456/p2p/QmeMfSRqVZktQp93zbjmn5jyTfDW1p8jGXYUeWsA78NEVA}"
ROOT="/mnt/c/Users/MSI/Desktop/blitzwing"
LOG_DIR="${HOME}/.blitzwing"

python3 - "$HOST_ID" "$PEER" "$MOTHER_URL" <<'PY'
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
    with urllib.request.urlopen(req, timeout=150) as r:
        print("READY_STATUS", r.status)
        print(r.read().decode())
except urllib.error.HTTPError as e:
    print("READY_STATUS", e.code)
    print(e.read().decode())
PY

curl -sf "$MOTHER_URL/v1/hosts" | python3 -m json.tool

nohup bash -c "while true; do curl -sf -X POST '${MOTHER_URL}/v1/hosts/heartbeat' -H 'Content-Type: application/json' -d '{\"host_id\":\"${HOST_ID}\"}' >/dev/null || true; sleep 20; done" \
  > "${LOG_DIR}/contrib_heartbeat.out" 2>&1 &

cd "$ROOT/examples/x402_chat_client"
export BLITZWING_BASE_URL="${MOTHER_URL}/v1"
export BLITZWING_QUERY="Say hello in one short sentence."
npm start
