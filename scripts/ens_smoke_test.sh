#!/usr/bin/env bash
# Gate 1: ENS service smoke test against Sepolia.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
ENS_URL="${ENS_SERVICE_URL:-http://127.0.0.1:8792}"

if [[ -f "${REPO_ROOT}/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "${REPO_ROOT}/.env"
  set +a
fi

echo "==> health"
curl -sf "${ENS_URL}/health" | python3 -m json.tool

# hostId label must be host-<hex> (see hostIdToLabel)
HOST_ID="host-$(printf '%012x' "$(date +%s)")"
echo "==> provision ${HOST_ID}"
PROV=$(curl -sf -X POST "${ENS_URL}/v1/hosts/provision" \
  -H 'content-type: application/json' \
  -d "{\"hostId\":\"${HOST_ID}\",\"role\":\"contributor\",\"hederaAccountId\":\"0.0.999001\",\"blockIndices\":\"20:24\",\"layersHosted\":4,\"model\":\"smoke/test\"}")
echo "${PROV}" | python3 -m json.tool
ENS_NAME=$(echo "${PROV}" | python3 -c "import sys,json; print(json.load(sys.stdin)['ensName'])")

echo "==> resolve"
curl -sf "${ENS_URL}/v1/hosts/resolve?name=${ENS_NAME}" | python3 -m json.tool

echo "==> update block range"
curl -sf -X POST "${ENS_URL}/v1/hosts/update" \
  -H 'content-type: application/json' \
  -d "{\"ensName\":\"${ENS_NAME}\",\"blockIndices\":\"18:24\",\"layersHosted\":6}" | python3 -m json.tool

echo "==> resolve after update"
curl -sf "${ENS_URL}/v1/hosts/resolve?name=${ENS_NAME}" | python3 -m json.tool

echo "==> deactivate"
curl -sf -X POST "${ENS_URL}/v1/hosts/deactivate" \
  -H 'content-type: application/json' \
  -d "{\"ensName\":\"${ENS_NAME}\"}" | python3 -m json.tool

echo "==> Gate 1 PASS"
