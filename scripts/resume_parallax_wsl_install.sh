#!/usr/bin/env bash
set -euo pipefail
export PATH="$HOME/.local/bin:$PATH"
mkdir -p "$HOME/.parallax-logs"
cd "$HOME/parallax"
pkill -f './install.sh --extras gpu' 2>/dev/null || true
sleep 1
echo "protoc: $(protoc --version)"
echo "resuming parallax install..."
nohup ./install.sh --extras gpu > "$HOME/.parallax-logs/install.log" 2>&1 &
sleep 3
tail -10 "$HOME/.parallax-logs/install.log"
echo "INSTALL_STARTED pid=$!"
