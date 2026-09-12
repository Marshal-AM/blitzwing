#!/usr/bin/env bash
# Fast E2E: clean WSL contributor + join 18:22 + ready.
set -euo pipefail
MOTHER="${MOTHER_URL:-http://136.113.86.69:8000}"
ROOT=/mnt/c/Users/MSI/Desktop/blitzwing
source "${HOME}/.blitzwing-venv/bin/activate"
export PYTHONPATH="$ROOT"

fuser -k 8011/tcp 31338/tcp 2>/dev/null || true
pkill -f 'petals.cli.run_server.*31338' 2>/dev/null || true
pkill -f 'uvicorn shard_manager.app:app --host 0.0.0.0 --port 8011' 2>/dev/null || true
sleep 2

python3 <<PY
import json, urllib.request
mother = "$MOTHER".rstrip("/")
for h in json.load(urllib.request.urlopen(mother + "/v1/hosts", timeout=15)).get("hosts", []):
    if h.get("role") == "contributor":
        body = json.dumps({"host_id": h["host_id"]}).encode()
        req = urllib.request.Request(mother + "/v1/hosts/leave", data=body, method="POST",
            headers={"Content-Type": "application/json"})
        try:
            urllib.request.urlopen(req, timeout=30)
            print("left", h["host_id"])
        except Exception as e:
            print("leave err", h["host_id"], e)
PY

exec bash "$ROOT/scripts/gcp_wsl_contributor_relay.sh"
