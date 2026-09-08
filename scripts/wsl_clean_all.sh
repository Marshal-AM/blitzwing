#!/usr/bin/env bash
# Nuclear cleanup on WSL contributor — kill everything, wipe state. Do NOT rejoin.
set -euo pipefail

LOG_DIR="${HOME}/.blitzwing"
SHARD_PORT="${BLITZWING_SHARD_PORT:-8011}"
PETALS_PORT="${BLITZWING_PETALS_PORT:-31338}"

echo "=== KILLING WSL CONTRIBUTOR PROCESSES ==="
pkill -9 -x ngrok 2>/dev/null || true
pkill -9 -f 'ngrok http' 2>/dev/null || true
pkill -9 -f 'uvicorn shard_manager' 2>/dev/null || true
pkill -9 -f 'petals.cli.run_server' 2>/dev/null || true
pkill -9 -f 'contrib_heartbeat' 2>/dev/null || true
fuser -k "${SHARD_PORT}/tcp" "${PETALS_PORT}/tcp" 4040/tcp 2>/dev/null || true
sleep 2

echo "=== WIPING WSL STATE ==="
mkdir -p "$LOG_DIR"
: > "${LOG_DIR}/contrib_shard.out"
: > "${LOG_DIR}/contrib_heartbeat.out"
: > "${LOG_DIR}/ngrok_http.out" 2>/dev/null || true

echo "=== REMAINING (should be empty) ==="
pgrep -af 'uvicorn|petals|ngrok' || echo "(none)"
ss -lntp 2>/dev/null | grep -E ":${SHARD_PORT}|:${PETALS_PORT}|:4040" || echo "(ports free)"
echo "WSL_CLEAN_DONE"
