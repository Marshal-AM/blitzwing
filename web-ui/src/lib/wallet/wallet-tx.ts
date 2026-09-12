import { AccountId, Hbar, type Transaction, type TransactionResponse } from "@hiero-ledger/sdk";
import { ensureWalletReadyForSigning } from "./hashpack-connect";
import { getDAppConnector } from "./hedera-wallet";

const WALLET_TIMEOUT_MS = 120_000;

export function withWalletTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        new Error(
          `${label} timed out after ${WALLET_TIMEOUT_MS / 1000}s. Open HashPack and approve any pending request, then retry.`,
        ),
      );
    }, WALLET_TIMEOUT_MS);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export async function walletSignTransaction(
  accountId: string,
  transaction: Transaction,
  label: string,
): Promise<Transaction> {
  const dApp = await getDAppConnector();
  await ensureWalletReadyForSigning(dApp);
  const signer = dApp.getSigner(AccountId.fromString(accountId));
  const tx = transaction.setMaxTransactionFee(new Hbar(5));

  if (typeof signer.signTransaction === "function") {
    return withWalletTimeout(signer.signTransaction(tx) as Promise<Transaction>, label);
  }

  throw new Error("Wallet does not support signTransaction — update HashPack");
}
