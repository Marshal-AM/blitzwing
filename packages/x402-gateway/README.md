# Public x402 gateway (`@x402/core` + `@x402/hedera`)

Sits in front of the FastAPI orchestrator and gates `POST /v1/chat/completions`
with the **official** Hedera x402 stack (same as the x500 example merchant):

- `x402ResourceServer` + `x402HTTPResourceServer` from `@x402/core`
- `ExactHederaScheme` from `@x402/hedera/exact/server`

```
Client (@x402/hedera exact/client)
  → :8000  packages/x402-gateway  (processHTTPRequest → settle → proxy)
  → :8002  orchestrator FastAPI   (inference + layer-weighted HBAR payouts + HCS)
```

## Env (repo-root `.env`)

```bash
X402_ENABLED=1
MOTHER_ACCOUNT_ID=0.0.xxx          # payTo
COST_PER_LAYER_TINYBARS=10000000
TOTAL_LAYERS=22
FACILITATOR_URL=http://127.0.0.1:8791
ORCHESTRATOR_INTERNAL_URL=http://127.0.0.1:8002
X402_GATEWAY_PORT=8000
```

## Run

```bash
cd packages/x402-gateway
npm install
npm start
```

Mother FastAPI must listen on `8002` when x402 is enabled
(see `scripts/restart_local_mother.sh`).
