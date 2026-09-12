#!/usr/bin/env bash
# Full health check: facilitator, ENS, petals, shard manager, orchestrator, gateway.
set -euo pipefail

FAIL=0
check() {
  local name="$1" url="$2"
  if curl -sf -m 5 "$url" >/dev/null 2>&1; then
    echo "  OK  $name  $url"
  else
    echo "  FAIL $name  $url"
    FAIL=1
  fi
}

echo "========== FULL GCP HEALTH CHECK =========="
check "facilitator"   "http://127.0.0.1:8791/health"
check "ens-service"   "http://127.0.0.1:8792/health"
check "shard_manager" "http://127.0.0.1:8001/status"
check "orchestrator"  "http://127.0.0.1:8002/health"
check "gateway"       "http://127.0.0.1:8000/health"

echo ""
echo "--- petals ---"
if pgrep -f 'petals.cli.run_server' >/dev/null 2>&1; then
  pgrep -af 'petals.cli.run_server' | head -3
  echo "  OK  petals process"
else
  echo "  FAIL petals process"
  FAIL=1
fi

echo ""
echo "--- ports ---"
ss -lntp 2>/dev/null | grep -E ':8000|:8001|:8002|:8791|:8792|:31337' || true

echo ""
echo "--- swarm ---"
curl -sf -m 5 http://127.0.0.1:8000/v1/hosts | python3 -m json.tool 2>/dev/null || echo "(hosts unavailable)"

echo ""
if [[ "$FAIL" -eq 0 ]]; then
  echo "ALL_HEALTHY"
  exit 0
else
  echo "HEALTH_CHECK_FAILED"
  exit 1
fi
