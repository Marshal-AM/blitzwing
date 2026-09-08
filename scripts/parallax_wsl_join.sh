#!/usr/bin/env bash
# Install Parallax and join GCP scheduler from WSL (contributor node).
# Model: Qwen/Qwen3-0.6B (600M params, under 1B)
# Usage: SCHEDULER_ADDR=12D3Koo... bash scripts/parallax_wsl_join.sh
set -euo pipefail

SCHEDULER_ADDR="${SCHEDULER_ADDR:-}"
TCP_PORT="${PARALLAX_TCP_PORT:-38100}"
UDP_PORT="${PARALLAX_UDP_PORT:-38101}"
PARALLAX_DIR="${HOME}/parallax"
LOG_DIR="${HOME}/.parallax-logs"
mkdir -p "$LOG_DIR"

if [[ -z "$SCHEDULER_ADDR" ]]; then
  echo "ERROR: Set SCHEDULER_ADDR to the scheduler peer ID from GCP logs."
  echo "  SCHEDULER_ADDR=12D3Koo... bash $0"
  exit 1
fi

if [[ ! -d "$PARALLAX_DIR/.venv" ]]; then
  echo "==> Installing Parallax in WSL..."
  git clone https://github.com/GradientHQ/parallax.git "$PARALLAX_DIR" || true
  cd "$PARALLAX_DIR"
  ./install.sh --extras gpu 2>&1 | tee "${LOG_DIR}/install.log"
else
  echo "==> Parallax already installed"
fi

cd "$PARALLAX_DIR"
source .venv/bin/activate

pkill -f 'parallax/launch.py' 2>/dev/null || true
sleep 2

: > "${LOG_DIR}/join.log"
echo "==> Joining scheduler $SCHEDULER_ADDR"
nohup parallax join \
  -s "$SCHEDULER_ADDR" \
  -u \
  --tcp-port "$TCP_PORT" \
  --udp-port "$UDP_PORT" \
  > "${LOG_DIR}/join.log" 2>&1 &

echo "Waiting for node to connect..."
for i in $(seq 1 120); do
  if grep -qE 'connected|ready|Started|block' "${LOG_DIR}/join.log" 2>/dev/null; then
    grep -E 'connected|ready|Started|block|layer' "${LOG_DIR}/join.log" | tail -5
    echo "JOIN_OK"
    exit 0
  fi
  if grep -qE 'Error|Traceback|failed' "${LOG_DIR}/join.log" 2>/dev/null; then
    tail -30 "${LOG_DIR}/join.log"
    exit 1
  fi
  sleep 5
done
tail -30 "${LOG_DIR}/join.log"
echo "JOIN_TIMEOUT - check logs at ${LOG_DIR}/join.log"
