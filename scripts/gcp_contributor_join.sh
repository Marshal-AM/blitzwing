#!/usr/bin/env bash
# Join a GCP contributor VM to the live mother (public IP — no ngrok).
set -euo pipefail

DISCOVERY_URL="${BLITZWING_DISCOVERY_URL:-http://35.238.86.1:9000}"
LAYERS="${BLITZWING_LAYERS:-4}"
HEDERA_ACCOUNT_ID="${BLITZWING_HEDERA_ACCOUNT_ID:-}"
PUBLIC_IP="${PUBLIC_IP:-$(curl -s --max-time 10 ifconfig.me)}"
SHARD_PORT="${BLITZWING_SHARD_PORT:-8011}"
PETALS_PORT="${BLITZWING_PETALS_PORT:-31338}"

if [[ -z "$HEDERA_ACCOUNT_ID" || ! "$HEDERA_ACCOUNT_ID" =~ ^0\.0\.[0-9]+$ ]]; then
  echo "Set BLITZWING_HEDERA_ACCOUNT_ID=0.0.xxxxx"
  exit 1
fi

echo "== blitzwing contributor on GCP =="
echo "discovery=$DISCOVERY_URL public_ip=$PUBLIC_IP layers=$LAYERS"

if ! command -v blitzwing >/dev/null 2>&1; then
  npm install -g blitzwing@latest
fi

export BLITZWING_DISCOVERY_URL="$DISCOVERY_URL"
export BLITZWING_HEDERA_ACCOUNT_ID="$HEDERA_ACCOUNT_ID"
export BLITZWING_ANNOUNCE_MADDRS="/ip4/${PUBLIC_IP}/tcp/${PETALS_PORT}"
export PETALS_USE_AUTO_RELAY=0
export BLITZWING_LOCAL_IP="$(hostname -I | awk '{print $1}')"

# Non-interactive join via env hints — run wizard with defaults
echo "Run: blitzwing"
echo "  - Network mode: Public IP / cloud VM"
echo "  - Public IP: $PUBLIC_IP"
echo "  - Layers: $LAYERS"
echo "  - Hedera: $HEDERA_ACCOUNT_ID"
echo "Or set BLITZWING_ANNOUNCE_MADDRS and use the interactive wizard."
