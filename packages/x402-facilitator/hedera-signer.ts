/**
 * Live Hedera facilitator signer for x402 Exact (HBAR).
 *
 * Built on official @x402/hedera primitives:
 *   createHederaSignAndSubmitTransaction
 *   createHederaVerifyPayerSignature
 *   createHederaPreflightTransfer
 */
import {
  AccountId,
  Client,
  PrivateKey,
  createHederaPreflightTransfer,
  createHederaSignAndSubmitTransaction,
  createHederaVerifyPayerSignature,
  type FacilitatorHederaSigner,
  HBAR_ASSET_ID,
  HEDERA_TESTNET_CAIP2,
} from "@x402/hedera";

export const HBAR_ASSET = HBAR_ASSET_ID;
export const HEDERA_TESTNET = HEDERA_TESTNET_CAIP2;

export function assertHbarExactRequirements(reqs: {
  asset?: string;
  network?: string;
}): void {
  if (reqs.network !== HEDERA_TESTNET) {
    throw new Error(
      `only ${HEDERA_TESTNET} accepted (got ${JSON.stringify(reqs.network)})`,
    );
  }
  if (reqs.asset !== HBAR_ASSET) {
    throw new Error(
      `only HBAR asset ${HBAR_ASSET} accepted (got ${JSON.stringify(reqs.asset)})`,
    );
  }
}

function parsePrivateKey(raw: string): ReturnType<typeof PrivateKey.fromString> {
  const key = raw.trim();
  try {
    return PrivateKey.fromStringECDSA(key);
  } catch {
    return PrivateKey.fromString(key);
  }
}

/**
 * Fee-payer signer: pays Hedera network fees and submits settlement txs.
 */
export function createLiveFacilitatorSigner(
  accountId: string,
  privateKeyHex: string,
): FacilitatorHederaSigner {
  const key = parsePrivateKey(privateKeyHex);
  const buildClient = (network: string): Client => {
    const client =
      network === "hedera:mainnet" ? Client.forMainnet() : Client.forTestnet();
    client.setOperator(AccountId.fromString(accountId), key);
    return client;
  };
  return {
    getAddresses: () => [accountId],
    signAndSubmitTransaction: createHederaSignAndSubmitTransaction(
      buildClient,
      key,
    ),
    resolveAccount: async () => ({ exists: true, isAlias: false }),
    verifyPayerSignature: createHederaVerifyPayerSignature(),
    preflightTransfer: createHederaPreflightTransfer(),
  };
}
