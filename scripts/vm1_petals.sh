#!/usr/bin/env bash
# Start Petals server on VM1 (bootstrap peer) — SmolLM2 layers [0, 16).
set -euo pipefail

MODEL_NAME="${MODEL_NAME:-HuggingFaceTB/SmolLM2-360M-Instruct}"
PORT="${PETALS_PORT:-31337}"
PUBLIC_IP="${PUBLIC_IP:?Set PUBLIC_IP to this VM's external (or VPC) IPv4}"
IDENTITY_PATH="${IDENTITY_PATH:-$HOME/petals-identity1}"
BLOCK_INDICES="${BLOCK_INDICES:-0:16}"

echo "Starting Petals bootstrap server"
echo "  model=${MODEL_NAME}"
echo "  blocks=${BLOCK_INDICES}"
echo "  public_ip=${PUBLIC_IP} port=${PORT}"
echo "Copy the /ip4/.../tcp/${PORT}/p2p/<PEER_ID> multiaddr from the logs into:"
echo "  - VM2 --initial_peers"
echo "  - orchestrator INITIAL_PEERS"

exec python -m petals.cli.run_server "${MODEL_NAME}" \
  --new_swarm \
  --device cpu \
  --quant_type none \
  --block_indices "${BLOCK_INDICES}" \
  --port "${PORT}" \
  --public_ip "${PUBLIC_IP}" \
  --identity_path "${IDENTITY_PATH}" \
  --num_handlers 1
