# Blitzwing x402 chat client

Pays for `POST /v1/chat/completions` using the official Hedera x402 SDK:

- `@x402/core` (`x402Client`, `x402HTTPClient`)
- `@x402/hedera` (`ExactHederaScheme`, `createClientHederaSigner`)

Same payment loop as x402 HTTP Exact: first request → 402 → sign payload → retry.

## Setup

Repo-root `.env`:

```bash
HEDERA_PRIVATE_KEY=0x...   # consumer ECDSA preferred
HEDERA_ACCOUNT_ID=0.0.xxx
```

Mother must expose the **gateway** on `:8000` with `X402_ENABLED=1` and
`COST_PER_LAYER_TINYBARS` set.

```bash
cd examples/x402_chat_client
npm install
npm start
```

Optional overrides: `BLITZWING_BASE_URL`, `BLITZWING_MODEL`, `BLITZWING_QUERY`.
