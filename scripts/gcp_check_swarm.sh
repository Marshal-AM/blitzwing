#!/usr/bin/env bash
set -euo pipefail
echo "== mother status =="
MOTHER_URL="${MOTHER_URL:-http://34.9.229.188:8000}"
curl -sS "${MOTHER_URL%/8000}:8001/status"
echo
curl -sS "${MOTHER_URL}/v1/hosts"
echo
echo "== contrib petals =="
tail -n 8 /home/msi/.blitzwing/contrib_shard.out || true
