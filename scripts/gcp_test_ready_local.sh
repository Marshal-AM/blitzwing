#!/usr/bin/env bash
python3 <<'PY'
import json, urllib.request, urllib.error
body = json.dumps({"host_id": "host-d7beff8c97b9"}).encode()
req = urllib.request.Request(
    "http://127.0.0.1:8002/v1/hosts/ready",
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
