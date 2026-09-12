#!/usr/bin/env bash
# Delete stale BLOOM caches and remove old discovery mother entries.
set -euo pipefail

DISCOVERY_IP="${DISCOVERY_IP:-34.70.57.65}"
DISCOVERY_ADMIN_TOKEN="${DISCOVERY_ADMIN_TOKEN:-blitzwing-prod-admin-2026-x402}"

echo "=== delete old model caches ==="
rm -rf ~/.cache/petals/models--bigscience--bloom-560m
rm -rf ~/.cache/petals/models--bigscience--bloom-petals
rm -rf ~/.cache/huggingface/hub/models--bigscience--bloom-560m
rm -rf ~/.cache/huggingface/hub/models--bigscience--bloom-petals
rm -rf ~/.cache/petals/models--TinyLlama--TinyLlama-1.1B-Chat-v1.0 2>/dev/null || true

echo "=== delete stale discovery entries ==="
curl -sS -X DELETE "http://${DISCOVERY_IP}:9000/v1/mothers/bigscience%2Fbloom-560m" \
  -H "Authorization: Bearer ${DISCOVERY_ADMIN_TOKEN}" || true
curl -sS -X DELETE "http://${DISCOVERY_IP}:9000/v1/mothers/TinyLlama%2FTinyLlama-1.1B-Chat-v1.0" \
  -H "Authorization: Bearer ${DISCOVERY_ADMIN_TOKEN}" || true

echo "=== current mothers ==="
curl -sS "http://${DISCOVERY_IP}:9000/v1/mothers"
echo
echo "MOTHER_CLEANUP_OK"
