#!/usr/bin/env bash
# Fix SSH timeouts on GCP VM
set -euo pipefail

echo "=== Configuring SSH to never timeout ==="

# Check if already configured
if grep -q "ClientAliveInterval 60" /etc/ssh/sshd_config 2>/dev/null; then
    echo "SSH already configured"
else
    sudo tee -a /etc/ssh/sshd_config > /dev/null << 'SSHEOF'

# Prevent SSH timeouts - added by blitzwing
ClientAliveInterval 60
ClientAliveCountMax 1440
TCPKeepAlive yes
SSHEOF
    sudo systemctl restart sshd
    echo "SSH config updated and restarted"
fi

echo "SSH_TIMEOUT_FIX_DONE"
