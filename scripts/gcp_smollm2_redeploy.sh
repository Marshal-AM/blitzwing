#!/usr/bin/env bash
# Redeploy GCP stack for HuggingFaceTB/SmolLM2-360M-Instruct (32 layers).
set -euo pipefail

export MODEL_NAME="${MODEL_NAME:-HuggingFaceTB/SmolLM2-360M-Instruct}"
export TOTAL_LAYERS="${TOTAL_LAYERS:-32}"
export BLOCK_INDICES="0:${TOTAL_LAYERS}"

ROOT="${HOME}/blitzwing"
cd "$ROOT"

echo "=== stop services ==="
pkill -f 'shard_manager' 2>/dev/null || true
pkill -f 'orchestrator.app' 2>/dev/null || true
pkill -f 'petals.cli.run_server' 2>/dev/null || true
sleep 2

echo "=== delete old model caches ==="
rm -rf ~/.cache/petals/models--bigscience--bloom-560m
rm -rf ~/.cache/petals/models--bigscience--bloom-petals
rm -rf ~/.cache/huggingface/hub/models--bigscience--bloom-560m
rm -rf ~/.cache/huggingface/hub/models--bigscience--bloom-petals
rm -rf ~/.cache/petals/models--TinyLlama--TinyLlama-1.1B-Chat-v1.0 2>/dev/null || true

echo "=== pull latest ==="
git fetch origin
git pull --ff-only origin main || git reset --hard origin/main

echo "=== restart mother stack ==="
bash scripts/gcp_full_restart_bloom.sh

PUBLIC_IP="$(curl -s --max-time 10 ifconfig.me || hostname -I | awk '{print $1}')"
DISCOVERY_IP="${DISCOVERY_IP:-34.70.57.65}"
DISCOVERY_ADMIN_TOKEN="${DISCOVERY_ADMIN_TOKEN:-blitzwing-prod-admin-2026-x402}"

echo "=== register SmolLM2 in discovery ==="
curl -sS -X PUT "http://${DISCOVERY_IP}:9000/v1/mothers/HuggingFaceTB%2FSmolLM2-360M-Instruct" \
  -H "Authorization: Bearer ${DISCOVERY_ADMIN_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{\"mother_url\":\"http://${PUBLIC_IP}:8000\",\"total_layers\":${TOTAL_LAYERS}}"

echo
echo "=== delete stale discovery entries ==="
curl -sS -X DELETE "http://${DISCOVERY_IP}:9000/v1/mothers/bigscience%2Fbloom-560m" \
  -H "Authorization: Bearer ${DISCOVERY_ADMIN_TOKEN}" || true
curl -sS -X DELETE "http://${DISCOVERY_IP}:9000/v1/mothers/TinyLlama%2FTinyLlama-1.1B-Chat-v1.0" \
  -H "Authorization: Bearer ${DISCOVERY_ADMIN_TOKEN}" || true

echo
curl -s "http://${DISCOVERY_IP}:9000/v1/mothers"
echo
echo "SMOLLM2_REDEPLOY_OK model=${MODEL_NAME} layers=${TOTAL_LAYERS} ip=${PUBLIC_IP}"
