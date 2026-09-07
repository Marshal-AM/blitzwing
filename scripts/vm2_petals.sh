#!/usr/bin/env bash
# Start Petals server on VM2 (joins VM1 swarm) — TinyLlama layers [11, 22).
set -euo pipefail

MODEL_NAME="${MODEL_NAME:-TinyLlama/TinyLlama-1.1B-Chat-v1.0}"
PORT="${PETALS_PORT:-31337}"
PUBLIC_IP="${PUBLIC_IP:?Set PUBLIC_IP to this VM's external (or VPC) IPv4}"
IDENTITY_PATH="${IDENTITY_PATH:-$HOME/petals-identity2}"
BLOCK_INDICES="${BLOCK_INDICES:-11:22}"
INITIAL_PEERS="${INITIAL_PEERS:?Set INITIAL_PEERS to VM1 bootstrap multiaddr (/ip4/.../p2p/...)}"

echo "Starting Petals join server"
echo "  model=${MODEL_NAME}"
echo "  blocks=${BLOCK_INDICES}"
echo "  initial_peers=${INITIAL_PEERS}"
echo "  public_ip=${PUBLIC_IP} port=${PORT}"

exec python -m petals.cli.run_server "${MODEL_NAME}" \
  --initial_peers "${INITIAL_PEERS}" \
  --device cpu \
  --quant_type none \
  --block_indices "${BLOCK_INDICES}" \
  --port "${PORT}" \
  --public_ip "${PUBLIC_IP}" \
  --identity_path "${IDENTITY_PATH}" \
  --num_handlers 1
