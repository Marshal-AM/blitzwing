#!/usr/bin/env bash
# Point facilitator fee payer at mother treasury (must differ from consumer payer).
set -euo pipefail
ROOT="${HOME}/blitzwing"
cd "$ROOT"
set -a
# shellcheck disable=SC1091
source "$ROOT/.env"
set +a

# Mother pays Hedera fees; consumer pays inference HBAR.
if [[ -z "${MOTHER_ACCOUNT_ID:-}" || -z "${MOTHER_PRIVATE_KEY:-}" ]]; then
  echo "MOTHER_ACCOUNT_ID / MOTHER_PRIVATE_KEY required in $ROOT/.env"
  exit 1
fi

grep -q '^FACILITATOR_ACCOUNT_ID=' "$ROOT/.env" \
  && sed -i "s|^FACILITATOR_ACCOUNT_ID=.*|FACILITATOR_ACCOUNT_ID=${MOTHER_ACCOUNT_ID}|" "$ROOT/.env" \
  || echo "FACILITATOR_ACCOUNT_ID=${MOTHER_ACCOUNT_ID}" >> "$ROOT/.env"
grep -q '^FACILITATOR_PRIVATE_KEY=' "$ROOT/.env" \
  && sed -i "s|^FACILITATOR_PRIVATE_KEY=.*|FACILITATOR_PRIVATE_KEY=${MOTHER_PRIVATE_KEY}|" "$ROOT/.env" \
  || echo "FACILITATOR_PRIVATE_KEY=${MOTHER_PRIVATE_KEY}" >> "$ROOT/.env"

set -a
# shellcheck disable=SC1091
source "$ROOT/.env"
set +a

cd "$ROOT/packages/x402-facilitator"
pkill -f 'packages/x402-facilitator/index.ts' || true
pkill -f 'x402-facilitator/index.ts' || true
sleep 1
nohup npx tsx index.ts > "${HOME}/blitzwing-logs/facilitator.log" 2>&1 &
for i in $(seq 1 30); do
  curl -sf http://127.0.0.1:8791/health && break
  sleep 1
done
echo
curl -sS http://127.0.0.1:8791/supported; echo
curl -sS http://127.0.0.1:8791/health; echo
echo FACILITATOR_FEE_PAYER_OK
