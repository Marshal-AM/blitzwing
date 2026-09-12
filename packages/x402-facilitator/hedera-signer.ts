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
  type FacilitatorHederaSigner,
  HBAR_ASSET_ID,
  HEDERA_TESTNET_CAIP2,
  HEDERA_TESTNET_MIRROR_NODE_URL,
} from "@x402/hedera";
import { Transaction, PublicKey } from "@hiero-ledger/sdk";

export const HBAR_ASSET = HBAR_ASSET_ID;
export const HEDERA_TESTNET = HEDERA_TESTNET_CAIP2;

// Debug version of verifyPayerSignature with logging
function createDebugVerifyPayerSignature() {
  return async ({ payer, transaction, network }: { payer: string; transaction: string; network: string }) => {
    console.log(`[VERIFY] payer=${payer} network=${network}`);
    console.log(`[VERIFY] transaction base64 length=${transaction.length}`);
    
    try {
      const tx = Transaction.fromBytes(Buffer.from(transaction, "base64"));
      console.log(`[VERIFY] tx type=${tx.constructor.name}`);
      
      // Get signatures from the transaction - check ALL signed transactions
      const signedTxs = (tx as any)._signedTransactions;
      console.log(`[VERIFY] signedTxs count=${signedTxs?.length || 0}`);
      
      // Check signatures on each node's transaction
      for (let i = 0; i < (signedTxs?.length || 0); i++) {
        const signedTx = signedTxs.get(i);
        const sigPairs = signedTx?.sigMap?.sigPair || [];
        console.log(`[VERIFY] node[${i}] sigs=${sigPairs.length}`);
      }
      
      const signedTx = signedTxs?.get(0);
      if (signedTx) {
        const bodyBytes = signedTx.bodyBytes;
        console.log(`[VERIFY] bodyBytes length=${bodyBytes?.length || 0}`);
      }
      
      // Fetch payer's public key from mirror node
      const baseUrl = HEDERA_TESTNET_MIRROR_NODE_URL;
      const response = await fetch(`${baseUrl}/api/v1/accounts/${encodeURIComponent(payer)}`);
      if (!response.ok) {
        console.log(`[VERIFY] mirror node error: ${response.status}`);
        return { ok: false, reason: "signature_invalid", message: "could not fetch payer account" };
      }
      const account = await response.json();
      console.log(`[VERIFY] mirror key type=${account.key?._type} key=${account.key?.key?.substring(0, 20)}...`);
      
      // Parse the key
      let key: PublicKey | null = null;
      if (account.key?._type === "ED25519") {
        key = PublicKey.fromStringED25519(account.key.key);
      } else if (account.key?._type === "ECDSA_SECP256K1") {
        key = PublicKey.fromStringECDSA(account.key.key);
      }
      
      if (!key) {
        console.log(`[VERIFY] could not parse key`);
        return { ok: false, reason: "signature_invalid", message: "could not resolve payer key" };
      }
      
      console.log(`[VERIFY] parsed key: ${key.toStringRaw().substring(0, 20)}...`);
      
      // Try SDK's verifyTransaction first
      const verified = key.verifyTransaction(tx);
      console.log(`[VERIFY] verifyTransaction result=${verified}`);
      
      if (verified) {
        return { ok: true };
      }
      
      // Fallback: manually verify the first signed transaction's signature
      // HashPack may only sign one node's transaction body
      const signedTx = (tx as any)._signedTransactions?.get(0);
      if (signedTx?.bodyBytes && signedTx?.sigMap?.sigPair?.length > 0) {
        const bodyBytes = signedTx.bodyBytes;
        for (const pair of signedTx.sigMap.sigPair) {
          const sigBytes = pair.ed25519 || pair.ECDSASecp256k1;
          if (sigBytes) {
            try {
              const manualVerified = key.verify(bodyBytes, sigBytes);
              console.log(`[VERIFY] manual verify result=${manualVerified}`);
              if (manualVerified) {
                return { ok: true };
              }
            } catch (e) {
              console.log(`[VERIFY] manual verify error: ${e}`);
            }
          }
        }
      }
      
      return { ok: false, reason: "signature_invalid", message: `payer ${payer} did not sign the transaction` };
    } catch (err) {
      console.log(`[VERIFY] error: ${err}`);
      return { ok: false, reason: "signature_invalid", message: String(err) };
    }
  };
}

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
    verifyPayerSignature: createDebugVerifyPayerSignature(),
    preflightTransfer: createHederaPreflightTransfer(),
  };
}
