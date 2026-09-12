#!/usr/bin/env bash
# Re-join contributor if Petals is already running (fast ready path).
set -euo pipefail
export MOTHER_URL="${MOTHER_URL:-http://136.113.86.69:8000}"
export BLITZWING_HEDERA_ACCOUNT_ID="${BLITZWING_HEDERA_ACCOUNT_ID:-0.0.6111100}"
export BLITZWING_LAYERS="${BLITZWING_LAYERS:-4}"
export CONTRIB_SKIP_GIT_RESET=1

if ! pgrep -f 'petals.cli.run_server' >/dev/null 2>&1; then
  echo "Petals not running — full join"
  exec bash "${HOME}/blitzwing/scripts/gcp_discovery_contributor_join.sh"
fi

bash "${HOME}/blitzwing/scripts/tmp_contrib_finish_ready.sh"
