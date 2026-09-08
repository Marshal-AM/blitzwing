#!/usr/bin/env bash
set -euo pipefail
ROOT=/home/MSI/blitzwing
fuser -k 8000/tcp 2>/dev/null || true
pkill -9 -f 'x402-gateway/node_modules' || true
sleep 2
set -a
# shellcheck disable=SC1091
source "$ROOT/.env"
set +a
cd "$ROOT/packages/x402-gateway"
: > /home/MSI/blitzwing-logs/x402-gateway.log
nohup npx tsx index.ts > /home/MSI/blitzwing-logs/x402-gateway.log 2>&1 &
for i in $(seq 1 20); do curl -sf -m 3 http://127.0.0.1:8000/health >/dev/null && break; sleep 1; done
curl -sS -m 5 http://127.0.0.1:8000/health; echo
curl -sS -m 5 http://127.0.0.1:8791/supported; echo
tail -n 10 /home/MSI/blitzwing-logs/x402-gateway.log
