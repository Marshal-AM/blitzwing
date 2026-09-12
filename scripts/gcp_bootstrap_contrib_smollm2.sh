#!/usr/bin/env bash
# Bootstrap blitzwing-contrib-1: install deps, join mother swarm as SmolLM2 contributor.
set -euo pipefail

ROOT="${HOME}/blitzwing"
REPO_URL="${BLITZWING_REPO_URL:-https://github.com/Marshal-AM/blitzwing.git}"
MOTHER_URL="${MOTHER_URL:-http://34.9.229.188:8000}"
DISCOVERY_URL="${BLITZWING_DISCOVERY_URL:-http://34.70.57.65:9000}"
HEDERA_ACCOUNT_ID="${BLITZWING_HEDERA_ACCOUNT_ID:-0.0.6111100}"
LAYERS="${BLITZWING_LAYERS:-4}"

mkdir -p "${HOME}/blitzwing-logs"

if [[ ! -d "${ROOT}/.git" ]]; then
  echo "== clone blitzwing =="
  git clone "${REPO_URL}" "${ROOT}"
fi

cd "${ROOT}"
if [[ "${CONTRIB_SKIP_GIT_RESET:-0}" != "1" ]]; then
  git fetch origin
  git reset --hard origin/main || true
fi

export MOTHER_URL
export BLITZWING_HEDERA_ACCOUNT_ID="${HEDERA_ACCOUNT_ID}"
export BLITZWING_LAYERS="${LAYERS}"
export BLITZWING_DISCOVERY_URL="${DISCOVERY_URL}"

bash "${ROOT}/scripts/gcp_discovery_contributor_join.sh"
