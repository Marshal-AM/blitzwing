import type { DAppConnector } from "@hashgraph/hedera-wallet-connect";

export function findHashpackExtension(dApp: DAppConnector) {
  return dApp.extensions.find(
    (ext) => ext.id === "hashpack" || ext.name?.toLowerCase().includes("hashpack"),
  );
}

export async function waitForHashpackExtension(dApp: DAppConnector, maxMs = 2500): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    if (findHashpackExtension(dApp)?.available) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

export async function connectHashpackOrModal(dApp: DAppConnector): Promise<void> {
  await waitForHashpackExtension(dApp);
  const hashpack = findHashpackExtension(dApp);
  if (hashpack?.available) {
    await dApp.connectExtension(hashpack.id);
    return;
  }
  await dApp.openModal(undefined, true);
}

export async function ensureWalletReadyForSigning(dApp: DAppConnector): Promise<void> {
  if (dApp.signers.length > 0) return;
  await connectHashpackOrModal(dApp);
}
