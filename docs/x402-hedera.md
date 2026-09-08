# Blitzwing x402 + Hedera core loop (no ENS)

## Stack

Official Hedera x402 SDK (same packages as `C:\Users\MSI\Desktop\x500`):

- `@x402/core` — resource server + HTTP client helpers
- `@x402/hedera` — `ExactHederaScheme` (exact / HBAR, `asset: 0.0.0`)
- Facilitator: local `@x500/facilitator` (default `http://127.0.0.1:8791`)

## Flow

1. Contributor joins via `blitzwing` and registers a **Hedera account ID**.
2. Consumer hits public gateway `POST /v1/chat/completions` → **402** with price  
   `TOTAL_LAYERS * COST_PER_LAYER_TINYBARS` tinybars, `payTo = MOTHER_ACCOUNT_ID`,  
   network `hedera:testnet`.
3. Client pays with `@x402/core` + `@x402/hedera/exact/client` (see `examples/x402_chat_client`).
4. Gateway **verify → settle**, then proxies to FastAPI for Petals inference.
5. Mother redistributes HBAR to each online host:  
   `layers_hosted * COST_PER_LAYER_TINYBARS` (batch `TransferTransaction`).
6. Audit entry on **HCS**; receipt returned as `blitzwing_payment`.

x402 only supports a **single** `payTo` per payment. Multi-host payouts are
intentional post-settlement redistribution.

## Topology

```
Client (@x402/hedera)
  → :8000  packages/x402-gateway   (@x402/core + @x402/hedera Exact)
  → :8002  orchestrator FastAPI    (inference + layer payouts + HCS)
```

## Facilitator

Run the local x500 facilitator before the gateway (same machine as x500 `.env`):

```bash
# from C:\Users\MSI\Desktop\x500
pnpm facilitator:dev   # → http://127.0.0.1:8791
```

Blitzwing `FACILITATOR_URL` must point at that process (not a Cloud Run URL).

## Run order (local)

1. Facilitator (x500): `pnpm facilitator:dev` → `:8791`
2. Mother stack: `wsl bash scripts/restart_local_mother.sh` (orchestrator `:8002` + gateway `:8000` when `X402_ENABLED=1`)
3. Or start gateway alone: `cd packages/x402-gateway && npm start`
4. Paying client: `cd examples/x402_chat_client && npm start`

## Mother env

```bash
X402_ENABLED=1
COST_PER_LAYER_TINYBARS=10000000   # 0.1 HBAR per layer
MOTHER_ACCOUNT_ID=0.0.xxxxxxxx
MOTHER_PRIVATE_KEY=0x...
FACILITATOR_URL=http://127.0.0.1:8791
HEDERA_NETWORK=hedera-testnet
ORCHESTRATOR_INTERNAL_URL=http://127.0.0.1:8002
X402_GATEWAY_PORT=8000
# HCS_TOPIC_ID=                 # optional; auto-created
```

## Run gateway

```bash
cd packages/x402-gateway
npm install
npm start
```

FastAPI must listen on `8002` when the gateway owns `:8000`
(`scripts/restart_local_mother.sh` does this when `X402_ENABLED=1`).

## Consumer example

```bash
# .env: HEDERA_PRIVATE_KEY + HEDERA_ACCOUNT_ID (payer)
cd examples/x402_chat_client
npm install && npm start
```

## Verify

- `GET /health` on the gateway shows `x402_enabled`, `payTo`, `priceTinybars`
- `GET /v1/hosts` shows `hedera_account_id` + `cost_per_layer_tinybars`
- Response includes `blitzwing_payment` with per-host amounts + tx ids
- Check HashScan for `payout_tx_id` and HCS topic messages
