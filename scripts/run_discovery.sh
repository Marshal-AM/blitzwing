#!/usr/bin/env bash
# Run the discovery service locally or on a small VM / Cloud Run container entrypoint.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
export DISCOVERY_ADMIN_TOKEN="${DISCOVERY_ADMIN_TOKEN:?Set DISCOVERY_ADMIN_TOKEN}"
export DISCOVERY_DB_PATH="${DISCOVERY_DB_PATH:-$HOME/.blitzwing/discovery.db}"
PORT="${DISCOVERY_PORT:-9000}"

cd "${REPO_ROOT}"
exec python -m uvicorn discovery_service.app:app --host 0.0.0.0 --port "${PORT}"
