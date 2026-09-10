#!/usr/bin/env bash
# Register parent .eth on Sepolia ENSv2 Beta (company wallet).
# Requires: ENS_OPERATOR_PRIVATE_KEY, ENS_SEPOLIA_RPC_URL in repo .env or environment.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

if [[ -f "${REPO_ROOT}/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "${REPO_ROOT}/.env"
  set +a
fi

PARENT="${ENS_PARENT_NAME:-blitzwing.eth}"
RPC="${ENS_SEPOLIA_RPC_URL:-}"
KEY="${ENS_OPERATOR_PRIVATE_KEY:-}"

if [[ -z "${KEY}" || -z "${RPC}" ]]; then
  echo "Set ENS_OPERATOR_PRIVATE_KEY and ENS_SEPOLIA_RPC_URL in ${REPO_ROOT}/.env"
  exit 1
fi

echo "==> ENS parent bootstrap for ${PARENT}"
echo "    RPC: ${RPC}"

cd "${REPO_ROOT}/packages/ens-service"
npm install --silent 2>/dev/null || npm install

ENS_PARENT_NAME="${PARENT}" \
ENS_SEPOLIA_RPC_URL="${RPC}" \
ENS_OPERATOR_PRIVATE_KEY="${KEY}" \
  npx tsx src/bootstrap-parent.ts

echo "==> Done. Check ~/.blitzwing/ens_parent.json"
