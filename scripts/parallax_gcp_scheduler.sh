#!/usr/bin/env bash
# Install and start Parallax scheduler on GCP VM (mother node).
# Usage: bash scripts/parallax_gcp_scheduler.sh
set -euo pipefail

PARALLAX_DIR="${HOME}/parallax"
MODEL="${PARALLAX_MODEL:-Qwen/Qwen3-0.6B}"  # 600M params — must stay under 1B
NODES="${PARALLAX_NODES:-2}"
LOG_DIR="${HOME}/parallax-logs"
TCP_PORT="${PARALLAX_TCP_PORT:-38100}"
UDP_PORT="${PARALLAX_UDP_PORT:-38101}"

mkdir -p "$LOG_DIR"

if [[ ! -d "$PARALLAX_DIR/.venv" ]]; then
  echo "==> Cloning and installing Parallax..."
  git clone https://github.com/GradientHQ/parallax.git "$PARALLAX_DIR" || true
  cd "$PARALLAX_DIR"
  ./install.sh --extras gpu -u 2>&1 | tee "${LOG_DIR}/install.log"
else
  echo "==> Parallax already installed at $PARALLAX_DIR"
fi

cd "$PARALLAX_DIR"
source .venv/bin/activate

pkill -f 'backend/main.py' 2>/dev/null || true
pkill -f 'parallax/launch.py' 2>/dev/null || true
sleep 2

: > "${LOG_DIR}/scheduler.log"
echo "==> Starting Parallax scheduler: model=$MODEL nodes=$NODES"
nohup parallax run \
  -m "$MODEL" \
  -n "$NODES" \
  -u \
  --host 0.0.0.0 \
  --tcp-port "$TCP_PORT" \
  --udp-port "$UDP_PORT" \
  > "${LOG_DIR}/scheduler.log" 2>&1 &

echo "Waiting for scheduler..."
for i in $(seq 1 60); do
  if curl -sf http://127.0.0.1:3001/health >/dev/null 2>&1; then
    echo "SCHEDULER_UP"
    break
  fi
  sleep 5
done

echo "==> Scheduler log (look for peer ID / scheduler address):"
grep -E 'scheduler|peer|12D3Koo|listening|error|Error' "${LOG_DIR}/scheduler.log" | tail -20 || tail -20 "${LOG_DIR}/scheduler.log"
echo
echo "SCHEDULER_PEER_ID=$(grep -oE '12D3Koo[A-Za-z0-9]+' "${LOG_DIR}/scheduler.log" | head -1 || echo unknown)"
echo "Join from WSL with:"
echo "  parallax join -s <SCHEDULER_PEER_ID> -u --tcp-port $TCP_PORT --udp-port $UDP_PORT"
