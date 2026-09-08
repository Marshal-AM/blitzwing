#!/usr/bin/env bash
# Nuclear cleanup on mother GCP VM — kill all Blitzwing processes and wipe state.
set -euo pipefail

echo "=== KILLING ALL BLITZWING PROCESSES ==="
for proc in \
  'uvicorn shard_manager' \
  'uvicorn orchestrator' \
  'petals.cli.run_server' \
  'x402-gateway/index.ts' \
  'x402-facilitator/index.ts' \
  'gcp_tail_pay_logs'; do
  pkill -9 -f "$proc" 2>/dev/null || true
done
fuser -k 8000/tcp 8001/tcp 8002/tcp 8791/tcp 31337/tcp 2>/dev/null || true
sleep 3

echo "=== REMAINING (should be empty) ==="
pgrep -af 'uvicorn|petals|x402' || echo "(none)"

echo "=== WIPING STATE & LOGS ==="
rm -f "${HOME}/.blitzwing/swarm_registry.json"
rm -f "${HOME}/.blitzwing/hcs_topic_id"
mkdir -p "${HOME}/blitzwing-logs"
: > "${HOME}/blitzwing-logs/facilitator.log"
: > "${HOME}/blitzwing-logs/x402-gateway.log"
: > "${HOME}/blitzwing-logs/orchestrator.log"
: > "${HOME}/blitzwing-logs/shard_manager.log"

echo "=== PORTS (should be free) ==="
ss -lntp 2>/dev/null | grep -E ':8000|:8001|:8002|:8791|:31337' || echo "(all free)"
echo "GCP_CLEAN_DONE"
