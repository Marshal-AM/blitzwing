# ENS setup (Sepolia ENSv2 Beta)

Blitzwing uses **Ethereum Sepolia** for host identity. Hedera remains the payment chain.

## Who pays

The **mother operator** (company) pays all ENS costs:

| Operation | Token |
|-----------|-------|
| Register / renew parent `.eth` | MockUSDC (fee) + Sepolia ETH (gas) |
| Mint subnames, set records | Sepolia ETH (gas) only |
| Resolve (reads) | Free |

Contributors do **not** need Sepolia wallets.

## Prerequisites

1. Sepolia ETH from a public faucet
2. Sepolia RPC URL (Alchemy, Infura, or public)
3. Company operator private key (`ENS_OPERATOR_PRIVATE_KEY`)

## Contract addresses (Sepolia ENSv2 Beta)

From [ENS Deployments](https://docs.ens.domains/learn/deployments/):

| Contract | Address |
|----------|---------|
| MockUSDC | `0x768f42455a2d082e23ceef7d51e5787c82d67a39` |
| ETH Registrar | `0xa88553f454b77203b0d036a05c894d555eaaa2cc` |
| Universal Resolver (proxy) | `0xeEeEEEeE14D718C2B47D9923Deab1335E144EeEe` |

## Environment variables (mother `.env`)

```bash
ENS_ENABLED=1
ENS_PARENT_NAME=blitzwing.eth
ENS_SEPOLIA_RPC_URL=https://ethereum-sepolia-rpc.publicnode.com
ENS_OPERATOR_PRIVATE_KEY=0x...
ENS_SERVICE_URL=http://127.0.0.1:8792
ENS_MOCK_USDC_ADDRESS=0x768f42455a2d082e23ceef7d51e5787c82d67a39
ENS_STRICT=0
```

## Gate 0 — register parent name

```bash
# Mint free MockUSDC (6 decimals)
# Approve ETH Registrar, then register blitzwing.eth (or blitzwingsep.eth if taken)
./scripts/ens_bootstrap_parent.sh
```

Verify on [Sepolia ENS app](https://sepolia.app.ens.domains/):

- [ ] Parent name resolves
- [ ] Operator wallet has Sepolia ETH > 0.05
- [ ] `~/.blitzwing/ens_parent.json` written

## Start ENS service

```bash
cd packages/ens-service
npm install
npm start
curl http://127.0.0.1:8792/health
```

## Smoke test

```bash
./scripts/ens_smoke_test.sh
```
