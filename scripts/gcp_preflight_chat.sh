#!/usr/bin/env bash
set -euo pipefail
# Ensure ngrok + contributor still up
if ! curl -sf http://127.0.0.1:4040/api/tunnels >/dev/null; then
  setsid /home/msi/bin/ngrok tcp 31338 --log=stdout > /home/msi/.blitzwing/ngrok_contrib.out 2>&1 < /dev/null &
  sleep 4
fi
curl -sf http://127.0.0.1:4040/api/tunnels | python3 -c 'import sys,json; print(json.load(sys.stdin)["tunnels"][0]["public_url"])'
curl -sf http://127.0.0.1:8011/status || echo contrib_shard_down
curl -sf http://136.65.225.87:8001/status
echo
curl -sf http://136.65.225.87:8000/v1/hosts
echo
# heartbeat
curl -sf -X POST http://136.65.225.87:8000/v1/hosts/heartbeat -H 'Content-Type: application/json' -d '{"host_id":"host-95484cc4eade"}' || true
echo
