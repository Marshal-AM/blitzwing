#!/usr/bin/env bash
set -euo pipefail
URL="${1:-http://136.65.225.87:8000/v1/chat/completions}"
curl -sS -D - -o /tmp/bw402.body -X POST "$URL" \
  -H 'content-type: application/json' \
  -d '{"model":"TinyLlama/TinyLlama-1.1B-Chat-v1.0","messages":[{"role":"user","content":"hi"}],"max_tokens":8}'
echo
echo '--- body ---'
head -c 2000 /tmp/bw402.body; echo
echo '--- health ---'
curl -sS http://136.65.225.87:8000/health; echo
curl -sS http://136.65.225.87:8791/health; echo
