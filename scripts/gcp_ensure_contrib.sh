#!/usr/bin/env bash
# Ensure contributor shard manager + petals are running.
set -euo pipefail

ROOT="${HOME}/blitzwing"
LOG="${HOME}/blitzwing-logs"
PY="${HOME}/venv/bin/python"
MOTHER_URL="${MOTHER_URL:-http://34.9.229.188:8000}"
SHARD_PORT="${SHARD_PORT:-8011}"

mkdir -p "${LOG}"

if curl -sf -m 5 "http://127.0.0.1:${SHARD_PORT}/status" >/dev/null 2>&1 \
  && pgrep -f 'petals.cli.run_server' >/dev/null 2>&1; then
  echo "  OK  contributor shard + petals already running"
  curl -sf -m 5 "http://127.0.0.1:${SHARD_PORT}/status"; echo
  pgrep -af 'petals.cli.run_server' | head -1
  echo "GCP_CONTRIB_ENSURE_OK"
  exit 0
fi

echo "==> full contributor rejoin"
export MOTHER_URL
export CONTRIB_SKIP_GIT_RESET=1
bash "${ROOT}/scripts/gcp_discovery_contributor_join.sh"
