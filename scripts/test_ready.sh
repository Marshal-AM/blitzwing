#!/usr/bin/env bash
set -euo pipefail
python3 <<'PY'
import json, urllib.request, urllib.error
body = json.dumps({
    "host_id": "host-d7beff8c97b9",
    "peer_multiaddr": "/ip4/172.22.94.108/tcp/31338/p2p/QmeMfSRqVZktQp93zbjmn5jyTfDW1p8jGXYUeWsA78NEVA",
}).encode()
req = urllib.request.Request(
    "http://136.113.86.69:8000/v1/hosts/ready",
    data=body,
    headers={"Content-Type": "application/json"},
    method="POST",
)
try:
    with urllib.request.urlopen(req, timeout=130) as r:
        print("STATUS", r.status)
        print(r.read().decode())
except urllib.error.HTTPError as e:
    print("STATUS", e.code)
    print(e.read().decode())
PY
curl -sS http://136.113.86.69:8000/v1/hosts
echo
