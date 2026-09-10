# ENS identity backbone

Blitzwing links **Sepolia ENSv2** host names to **Hedera** payout wallets. The orchestrator keeps routing in its in-memory registry; ENS is the verifiable identity layer for judges and consumers.

## Architecture

```
Contributor CLI → Orchestrator registry (routing)
                      ↓ on ready/leave
                 ens-service (Sepolia writes)
                      ↓
                 blitzwing.eth subnames
                      ↓ verify before payout
                 Hedera escrow / HCS receipts
```

## Record schema

| Text key | Example |
|----------|---------|
| `com.blitzwing.hostId` | `host-f5e7d3cdd518` |
| `com.blitzwing.hederaAccountId` | `0.0.6111100` |
| `com.blitzwing.blockIndices` | `12:20` |
| `com.blitzwing.layersHosted` | `8` |
| `com.blitzwing.model` | `bigscience/bloom-560m` |
| `com.blitzwing.role` | `contributor` |
| `com.blitzwing.status` | `online` |

Naming: `mother.blitzwing.eth`, `host-{8hex}.blitzwing.eth`.

## Operator setup

See [ens-setup.md](ens-setup.md).

## Verify a paid receipt (Story 2)

```bash
cd examples/ens_verify_client
npm install
ENS_SEPOLIA_RPC_URL=... npm start -- payment.json
```

Or resolve directly:

```bash
curl "http://127.0.0.1:8792/v1/hosts/resolve?name=host-abc123.blitzwing.eth"
```

## Cost model

| Operation | Paid with |
|-----------|-----------|
| Register parent `.eth` | MockUSDC + Sepolia ETH |
| Subnames + records | Sepolia ETH |
| Reads | Free |

Company/mother operator pays everything; contributors only provide Hedera `0.0.N`.

## Feature flags

| Env | Effect |
|-----|--------|
| `ENS_ENABLED=1` | Provision/update on join/ready/leave |
| `ENS_STRICT=1` | Block payouts if ENS missing or verification fails |
| `ENS_ENABLED=0` | Legacy behavior (no ENS) |
