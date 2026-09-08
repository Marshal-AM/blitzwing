#!/usr/bin/env python3
import json
import sys
import urllib.request

url = sys.argv[1] if len(sys.argv) > 1 else "http://136.65.225.87:8000/v1/chain/prefix"
body = json.dumps({"input_ids": [1, 15043, 29892]}).encode()
req = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json"}, method="POST")
try:
    with urllib.request.urlopen(req, timeout=120) as resp:
        print(resp.status)
        print(resp.read().decode()[:200])
except urllib.error.HTTPError as e:
    print(e.code)
    print(e.read().decode()[:500])
