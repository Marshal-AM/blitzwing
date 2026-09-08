#!/usr/bin/env bash
set -euo pipefail
echo "== mother status =="
curl -sS http://136.65.225.87:8001/status
echo
curl -sS http://136.65.225.87:8000/v1/hosts
echo
echo "== contrib petals =="
tail -n 8 /home/msi/.blitzwing/contrib_shard.out || true
