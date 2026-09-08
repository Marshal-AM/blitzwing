# Blitzwing x402 + Hedera core loop (no ENS)

## Stack

Official Hedera x402 packages only:

- `@x402/core` — resource server + HTTP client + facilitator core
- `@x402/hedera` — `ExactHederaScheme` (exact / HBAR, `asset: 0.0.0`)
- `packages/x402-facilitator` — Blitzwing's verify/settle service
- `packages/x402-gateway` — public payment gate in front of FastAPI

## Flow

1. Contributor joins via `blitzwing` and registers a **Hedera account ID** (see [contributor-setup.md](contributor-setup.md)).
2. Consumer hits public gateway `POST /v1/chat/completions` → **402** with price  
   `TOTAL_LAYERS * COST_PER_LAYER_TINYBARS` tinybars, `payTo` = mother treasury or escrow contract,  
   network `hedera:testnet`.
3. Client pays with `@x402/core` + `@x402/hedera/exact/client`.
4. Gateway **verifies** payment, runs **inference**, then **settles** only on success.
5. Gateway calls orchestrator `/v1/internal/payout` after settle.
6. Mother redistributes HBAR to each online host by layers hosted (or escrow `release()` when configured).
7. Audit entry on **HCS**; receipt returned as `blitzwing_payment`.

## Topology

```
Client (@x402/hedera)
  → :8000  packages/x402-gateway
  → :8002  orchestrator FastAPI (inference + payouts + HCS)

Facilitator (same host, private):
  → :8791  packages/x402-facilitator
```

## Facilitator

```bash
cd packages/x402-facilitator
npm install
# .env: FACILITATOR_ACCOUNT_ID + FACILITATOR_PRIVATE_KEY (must differ from consumer payer)
npm start   # → http://127.0.0.1:8791
```

## Run order (local / VM)

1. Facilitator: `cd packages/x402-facilitator && npm start`
2. Orchestrator on `:8002` with `X402_ENABLED=1`
3. Gateway: `cd packages/x402-gateway && npm start` on `:8000`
4. Paying client: `cd examples/x402_chat_client && npm start`

## Mother env

```bash
X402_ENABLED=1
COST_PER_LAYER_TINYBARS=10000000
MOTHER_ACCOUNT_ID=0.0.xxxxxxxx
MOTHER_PRIVATE_KEY=0x...
FACILITATOR_URL=http://127.0.0.1:8791
FACILITATOR_ACCOUNT_ID=0.0.xxxxxxxx   # fee payer (needs HBAR; use mother treasury)
FACILITATOR_PRIVATE_KEY=0x...
HEDERA_NETWORK=hedera-testnet
ORCHESTRATOR_INTERNAL_URL=http://127.0.0.1:8002
X402_GATEWAY_PORT=8000
INFERENCE_TIMEOUT_SECONDS=90
READY_VERIFY_TIMEOUT_SECONDS=120
# Optional Phase 2 escrow:
# ESCROW_CONTRACT_ID=0.0.xxxxx
# ESCROW_EVM_ADDRESS=0x...
```

## Consumer example

```bash
cd examples/x402_chat_client
npm install && npm start
```

## Verify

- `GET :8791/health` and `/supported`
- `GET :8000/health` shows `x402_enabled`, `payTo`, `priceTinybars`
- Unpaid chat → **402** + `PAYMENT-REQUIRED`
- Failed inference → **503**, no settlement (consumer not charged)
- Paid chat → 200 + `blitzwing_payment`

## Escrow (optional)

Deploy `contracts/BlitzwingEscrow.sol` and set `ESCROW_CONTRACT_ID` + `ESCROW_EVM_ADDRESS`.  
Gateway `payTo` uses escrow when `ESCROW_CONTRACT_ID` or `X402_PAY_TO` is set.  
See [contracts/README.md](../contracts/README.md).
