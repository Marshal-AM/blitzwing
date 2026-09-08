# Blitzwing Escrow (Hedera EVM)

Trust-minimized payout rail: x402 settles HBAR to the escrow contract account; the orchestrator operator calls `release()` after successful inference.

## Deploy (Hedera testnet)

1. Install [Hardhat](https://hardhat.org/) and `@hashgraph/hardhat-hedera` (or use Hedera JSON-RPC relay).
2. Set `OPERATOR_EVM_ADDRESS` to the mother's EVM alias (same key as `MOTHER_PRIVATE_KEY`).
3. Deploy `BlitzwingEscrow.sol` and note the **contract account id** (`0.0.xxx`).

```bash
cd contracts
npm install
npx hardhat run scripts/deploy.js --network hedera_testnet
```

4. In repo `.env`:

```env
ESCROW_CONTRACT_ID=0.0.xxxxx
ESCROW_EVM_ADDRESS=0x...
X402_PAY_TO=0.0.xxxxx   # same as escrow contract account
```

5. Gateway uses `ESCROW_CONTRACT_ID` or `X402_PAY_TO` as `payTo` when set.

## Runtime flow

1. Consumer pays escrow via x402 (deferred settle after inference).
2. Orchestrator `/v1/internal/payout` calls `release(requestId, recipients[], amounts[])`.
3. HCS audit log records escrow tx + per-host amounts.

Without `ESCROW_CONTRACT_ID`, the spine uses mother treasury + `hedera_payouts.redistribute()` (Phase 1).
