#!/usr/bin/env bash
# Join TWO WSL contributors (8 layers each) to GCP mother.
# Mother ends on 0:8, contributors on 8:16 and 16:24.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
[[ -f "$ROOT/shard_manager/app.py" ]] || ROOT=/mnt/c/Users/MSI/Desktop/blitzwing
cd "$ROOT"

MOTHER_URL="${MOTHER_URL:-http://136.65.225.87:8000}"
export MODEL_NAME="${MODEL_NAME:-bigscience/bloom-560m}"
export NEW_SWARM=1
export BLITZWING_HTTP_ONLY=1
export BLITZWING_LAYERS=8

echo "========== CONTRIBUTOR 1 (8 layers) =========="
export BLITZWING_SHARD_PORT=8011
export BLITZWING_PETALS_PORT=31338
export BLITZWING_HEDERA_ACCOUNT_ID="${CONTRIBUTOR1_HEDERA_ACCOUNT_ID:-0.0.6111101}"
export IDENTITY_PATH="${HOME}/.blitzwing/petals-identity-contributor-1"
export CONTRIB_SHARD_LOG="${HOME}/.blitzwing/contrib_shard_1.out"
bash scripts/gcp_wsl_contributor_relay.sh

echo ""
echo "========== CONTRIBUTOR 2 (8 layers) =========="
export BLITZWING_SHARD_PORT=8012
export BLITZWING_PETALS_PORT=31339
export BLITZWING_NGROK_WEB_PORT=4041
export BLITZWING_SKIP_LEAVE=1
export BLITZWING_SKIP_GLOBAL_CLEANUP=1
export BLITZWING_HEDERA_ACCOUNT_ID="${CONTRIBUTOR2_HEDERA_ACCOUNT_ID:-0.0.6111100}"
export IDENTITY_PATH="${HOME}/.blitzwing/petals-identity-contributor-2"
export CONTRIB_SHARD_LOG="${HOME}/.blitzwing/contrib_shard_2.out"
bash scripts/gcp_wsl_contributor_relay.sh

echo ""
echo "========== FINAL SWARM =========="
python3 - <<'PY' "$MOTHER_URL"
import json, sys, urllib.request
mother = sys.argv[1]
with urllib.request.urlopen(f"{mother.rstrip('/')}/v1/hosts", timeout=30) as r:
    print(json.dumps(json.load(r), indent=2))
PY

echo "DUAL_CONTRIBUTOR_JOIN_OK"
