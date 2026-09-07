#!/usr/bin/env bash
# Admin helpers for the Blitzwing Discovery Service.
# Usage:
#   ./scripts/discovery_admin.sh list
#   ./scripts/discovery_admin.sh register MODEL MOTHER_URL TOTAL_LAYERS
#   ./scripts/discovery_admin.sh update MODEL MOTHER_URL
#   ./scripts/discovery_admin.sh delete MODEL
set -euo pipefail

DISCOVERY_URL="${DISCOVERY_URL:?Set DISCOVERY_URL}"
DISCOVERY_ADMIN_TOKEN="${DISCOVERY_ADMIN_TOKEN:?Set DISCOVERY_ADMIN_TOKEN}"
AUTH_HEADER="Authorization: Bearer ${DISCOVERY_ADMIN_TOKEN}"

cmd="${1:-}"
shift || true

case "${cmd}" in
  list)
    curl -sS "${DISCOVERY_URL%/}/v1/mothers" | python3 -m json.tool
    ;;
  register)
    model="${1:?model}"
    mother_url="${2:?mother_url}"
    total_layers="${3:?total_layers}"
    curl -sS -X POST "${DISCOVERY_URL%/}/v1/mothers/register" \
      -H "${AUTH_HEADER}" \
      -H "Content-Type: application/json" \
      -d "{\"model\":\"${model}\",\"mother_url\":\"${mother_url}\",\"total_layers\":${total_layers}}" \
      | python3 -m json.tool
    ;;
  update)
    model="${1:?model}"
    mother_url="${2:?mother_url}"
    # URL-encode model path (slashes)
    encoded="$(python3 -c "import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1], safe=''))" "${model}")"
    curl -sS -X PUT "${DISCOVERY_URL%/}/v1/mothers/${encoded}" \
      -H "${AUTH_HEADER}" \
      -H "Content-Type: application/json" \
      -d "{\"mother_url\":\"${mother_url}\"}" \
      | python3 -m json.tool
    ;;
  delete)
    model="${1:?model}"
    encoded="$(python3 -c "import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1], safe=''))" "${model}")"
    curl -sS -X DELETE "${DISCOVERY_URL%/}/v1/mothers/${encoded}" \
      -H "${AUTH_HEADER}" \
      | python3 -m json.tool
    ;;
  *)
    echo "Usage: $0 {list|register|update|delete} ..." >&2
    exit 1
    ;;
esac
