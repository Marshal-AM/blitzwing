#!/usr/bin/env bash
set -euo pipefail
tail -n 80 /home/MSI/blitzwing-logs/x402-gateway.log
echo =====
tail -n 80 /home/MSI/blitzwing-logs/facilitator.log
echo =====
tail -n 40 /home/MSI/blitzwing-logs/orchestrator.log
