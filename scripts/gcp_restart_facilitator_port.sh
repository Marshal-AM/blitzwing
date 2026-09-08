#!/usr/bin/env bash
set -euo pipefail
ROOT="${HOME}/blitzwing"
# Kill facilitator by port and known cmdline
fuser -k 8791/tcp 2>/dev/null || true
pkill -9 -f 'x402-facilitator/node_modules/.bin/tsx' || true
pkill -9 -f 'x402-facilitator/node_modules/tsx' || true
sleep 2
ss -tlnp | grep 8791 || echo '8791 free'

set -a
# shellcheck disable=SC1091
source "$ROOT/.env"
set +a
echo "starting facilitator as FACILITATOR_ACCOUNT_ID=${FACILITATOR_ACCOUNT_ID}"
cd "$ROOT/packages/x402-facilitator"
: > "${HOME}/blitzwing-logs/facilitator.log"
nohup npx tsx index.ts > "${HOME}/blitzwing-logs/facilitator.log" 2>&1 &
for i in $(seq 1 20); do
  curl -sf http://127.0.0.1:8791/health >/dev/null && break
  sleep 1
done
curl -sS http://127.0.0.1:8791/health; echo
curl -sS http://127.0.0.1:8791/supported; echo
tail -n 20 "${HOME}/blitzwing-logs/facilitator.log"
pgrep -af 'x402-facilitator' || true
