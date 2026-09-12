#!/usr/bin/env bash
set -euo pipefail
MOTHER_URL="${MOTHER_URL:-http://136.113.86.69:8000}"
URL="${1:-${MOTHER_URL}/v1/chat/completions}"
curl -sS -D - -o /tmp/bw402.body -X POST "$URL" \
  -H 'content-type: application/json' \
  -d '{"model":"HuggingFaceTB/SmolLM2-360M-Instruct","messages":[{"role":"user","content":"hi"}],"max_tokens":8}'
echo
echo '--- body ---'
head -c 2000 /tmp/bw402.body; echo
echo '--- health ---'
curl -sS "${MOTHER_URL}/health"; echo
FACILITATOR_URL="${FACILITATOR_URL:-$(echo "$MOTHER_URL" | sed 's/:8000/:8791/')}"
curl -sS "${FACILITATOR_URL}/health"; echo
