#!/usr/bin/env bash
# Tail payment-path logs + quick service snapshot (mother VM).
set -euo pipefail
ROOT="${HOME}/blitzwing"
LOG_DIR="${HOME}/blitzwing-logs"

echo "========== SNAPSHOT $(date -u +%Y-%m-%dT%H:%M:%SZ) =========="
echo "--- git ---"
(cd "$ROOT" && git log -1 --oneline) || true
echo "--- ports ---"
ss -tlnp 2>/dev/null | grep -E ':8000|:8001|:8002|:8791' || echo "(no listeners)"
echo "--- processes ---"
pgrep -af 'x402-gateway|x402-facilitator|uvicorn orchestrator|uvicorn shard_manager' || true
echo "--- env (payment) ---"
grep -E '^(ESCROW_|MOTHER_ACCOUNT|X402_|FACILITATOR_|COST_PER_LAYER)' "$ROOT/.env" 2>/dev/null || true
echo "--- quick health (3s timeout) ---"
curl -sf -m 3 http://127.0.0.1:8791/supported >/dev/null && echo "facilitator: OK" || echo "facilitator: FAIL"
curl -sf -m 3 http://127.0.0.1:8002/health >/dev/null && echo "orchestrator: OK" || echo "orchestrator: FAIL/TIMEOUT"
curl -sf -m 3 http://127.0.0.1:8000/health >/dev/null && echo "gateway: OK" || echo "gateway: FAIL/TIMEOUT"
echo

echo "========== x402-gateway.log (last 80) =========="
tail -n 80 "${LOG_DIR}/x402-gateway.log" 2>/dev/null || echo "(missing)"
echo
echo "========== facilitator.log (last 80) =========="
tail -n 80 "${LOG_DIR}/facilitator.log" 2>/dev/null || \
  tail -n 80 "${LOG_DIR}/x402-facilitator.log" 2>/dev/null || echo "(missing)"
echo
echo "========== orchestrator.log (last 80) =========="
tail -n 80 "${LOG_DIR}/orchestrator.log" 2>/dev/null || echo "(missing)"
echo
echo "========== shard_manager.log (last 40) =========="
tail -n 40 "${LOG_DIR}/shard_manager.log" 2>/dev/null || echo "(missing)"
