#!/usr/bin/env bash
# Configure ngrok tunnels. Do NOT commit real tokens.
# Usage: NGROK_AUTHTOKEN=... bash scripts/setup_ngrok.sh
set -euo pipefail
: "${NGROK_AUTHTOKEN:?Set NGROK_AUTHTOKEN}"
NGROK="${HOME}/bin/ngrok"
"$NGROK" config add-authtoken "$NGROK_AUTHTOKEN"
mkdir -p "${HOME}/.config/ngrok"
cat > "${HOME}/.config/ngrok/ngrok.yml" <<EOF
version: "3"
agent:
  authtoken: ${NGROK_AUTHTOKEN}
tunnels:
  discovery:
    proto: http
    addr: 9000
  orchestrator:
    proto: http
    addr: 8000
  petals:
    proto: tcp
    addr: 31337
EOF
"$NGROK" config check
echo "Configured. Start with: ngrok start --all"
