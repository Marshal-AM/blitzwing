# `@blitzwing/x402-facilitator`

Official Hedera **x402 Exact** facilitator for Blitzwing.

Uses only:

- `@x402/core` — `x402Facilitator`
- `@x402/hedera` — `ExactHederaScheme` + live fee-payer signer helpers

## Endpoints

| Method | Path | Role |
|--------|------|------|
| GET | `/health` | Liveness |
| GET | `/supported` | Schemes / networks the facilitator accepts |
| POST | `/verify` | Validate payment payload vs requirements |
| POST | `/settle` | Fee-pay + submit on-chain settlement |

## Env

```bash
HEDERA_NETWORK=hedera:testnet
FACILITATOR_ACCOUNT_ID=0.0.xxx      # fee payer (needs testnet HBAR)
FACILITATOR_PRIVATE_KEY=0x...       # ECDSA preferred
FACILITATOR_PORT=8791
```

Also loaded from repo-root `.env`.

## Run

```bash
cd packages/x402-facilitator
npm install
npm start
```

Point the gateway at it:

```bash
FACILITATOR_URL=http://127.0.0.1:8791
```
