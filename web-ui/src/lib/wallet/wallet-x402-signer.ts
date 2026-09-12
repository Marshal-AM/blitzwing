import type { PaymentRequirements } from "@x402/core/types";
import type { ClientHederaSigner } from "@x402/hedera";
import {
  AccountId,
  Hbar,
  TokenId,
  TransactionId,
  TransferTransaction,
} from "@hiero-ledger/sdk";
import { walletSignTransaction } from "./wallet-tx";

function isHbarAsset(asset: string): boolean {
  return asset === "0.0.0";
}

export function createWalletHederaSigner(accountId: string): ClientHederaSigner {
  return {
    accountId,
    createPartiallySignedTransferTransaction: async (requirements: PaymentRequirements) => {
      const feePayer = requirements.extra?.feePayer;
      if (typeof feePayer !== "string") {
        throw new Error("feePayer is required in paymentRequirements.extra");
      }

      const amount = BigInt(requirements.amount);
      if (amount <= 0n) {
        throw new Error("amount must be greater than zero");
      }

      const parsedAccountId = AccountId.fromString(accountId);
      const payTo = AccountId.fromString(requirements.payTo);
      const tx = new TransferTransaction();

      if (isHbarAsset(requirements.asset)) {
        tx.addHbarTransfer(parsedAccountId, Hbar.fromTinybars((-amount).toString()));
        tx.addHbarTransfer(payTo, Hbar.fromTinybars(amount.toString()));
      } else {
        const tokenId = TokenId.fromString(requirements.asset);
        tx.addTokenTransfer(tokenId, parsedAccountId, -amount);
        tx.addTokenTransfer(tokenId, payTo, amount);
      }

      tx.setTransactionId(TransactionId.generate(AccountId.fromString(feePayer)));

      // HashPack must freeze + sign with the same @hiero-ledger/sdk (2.79) as
      // hedera-wallet-connect. Do not pre-freeze here — DAppSigner freezes internally.
      const signed = await walletSignTransaction(accountId, tx, "x402 payment");
      return Buffer.from(signed.toBytes()).toString("base64");
    },
  };
}
