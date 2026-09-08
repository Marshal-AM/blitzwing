#!/usr/bin/env bash
set -euo pipefail
pkill -f 'uvicorn shard_manager.app:app --host 0.0.0.0 --port 8011' 2>/dev/null || true
fuser -k 8011/tcp 31338/tcp 2>/dev/null || true
pkill -x ngrok 2>/dev/null || true
sleep 2
setsid /home/msi/bin/ngrok tcp 31338 --log=stdout > /home/msi/.blitzwing/ngrok_contrib.out 2>&1 < /dev/null &
sleep 4
curl -sf http://127.0.0.1:4040/api/tunnels
echo
sed -i 's/\r$//' /mnt/c/Users/MSI/Desktop/blitzwing/scripts/gcp_wsl_contributor_join.sh
bash /mnt/c/Users/MSI/Desktop/blitzwing/scripts/gcp_wsl_contributor_join.sh
