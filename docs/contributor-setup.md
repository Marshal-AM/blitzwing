# Contributor setup

Blitzwing contributors run **Petals** layers and receive HBAR payouts proportional to `layers_hosted`.

## Recommended: cloud VM with public IP

Best for production and E2E tests (no ngrok).

1. Provision a VM (GCP, AWS, etc.) with **inbound TCP 31337** (Petals) and **8001** (shard manager) open.
2. Install Node 18+ and Python 3.11.
3. `npm i -g blitzwing@latest`
4. `blitzwing` → choose **Public IP / cloud VM**, enter the VM's public IPv4.
5. Provide your **Hedera testnet account** for payouts.

The wizard sets `ANNOUNCE_MADDRS=/ip4/<PUBLIC_IP>/tcp/31337` and disables auto-relay.

See [gcp-setup.md](gcp-setup.md) for firewall rules.

## Home / laptop (NAT)

Choose **Auto (recommended for home / NAT)** in the wizard. Petals uses **libp2p auto-relay** so you do not need port forwarding or ngrok.

Optional env:

```bash
export PETALS_USE_AUTO_RELAY=1
export PETALS_SKIP_REACHABILITY_CHECK=1
```

## Dev-only: ngrok

`scripts/gcp_wsl_contributor_join.sh` and ngrok tunnels are **not** the product path. Use only for local debugging when a second public VM is unavailable.

## Handoff / readiness

After Petals loads your blocks, the mother verifies they appear in the swarm DHT before accepting `/v1/hosts/ready`. If verification fails, the join is released and you can retry.

## Payments

Consumers pay via x402 on the mother gateway. After **successful inference**, the gateway settles HBAR and triggers layer-weighted payouts (or escrow release when `ESCROW_CONTRACT_ID` is configured). See [x402-hedera.md](x402-hedera.md).
