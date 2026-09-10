/**
 * Independently verify blitzwing_payment receipt claims via Sepolia ENS.
 *
 * Usage:
 *   ENS_SEPOLIA_RPC_URL=... npm start -- path/to/payment.json
 *   npm start -- '{"hosts":[{"ens_name":"mother.blitzwing.eth",...}]}'
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { createPublicClient, http } from "viem";
import { sepolia } from "viem/chains";
import { addEnsContracts, createEnsPublicClient } from "@ensdomains/ensjs";
import { getTextRecord } from "@ensdomains/ensjs/public";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(__dirname, "../../.env") });

const RECORD_KEYS = {
  hederaAccountId: "com.blitzwing.hederaAccountId",
  blockIndices: "com.blitzwing.blockIndices",
  hostId: "com.blitzwing.hostId",
};

const rpc =
  process.env.ENS_SEPOLIA_RPC_URL ||
  process.env.SEPOLIA_RPC_URL ||
  "https://ethereum-sepolia-rpc.publicnode.com";

const chain = addEnsContracts(sepolia);
const client = createEnsPublicClient({ chain, transport: http(rpc) });

interface ReceiptHost {
  ens_name?: string;
  host_id?: string;
  hedera_account_id?: string;
  layers?: number;
  amount_tinybars?: number;
}

interface PaymentReceipt {
  hosts?: ReceiptHost[];
  payout_tx_id?: string;
  hcs_topic_id?: string;
  hcs_sequence?: string;
}

async function resolveEns(ensName: string) {
  const texts: Record<string, string | null> = {};
  for (const key of Object.values(RECORD_KEYS)) {
    texts[key] = await getTextRecord(client, { name: ensName, key });
  }
  return texts;
}

async function main() {
  const arg = process.argv[2];
  if (!arg) {
    console.error("Pass a payment JSON file path or inline JSON");
    process.exit(1);
  }
  const raw = arg.trim().startsWith("{")
    ? arg
    : fs.readFileSync(path.resolve(arg), "utf8");
  const receipt = JSON.parse(raw) as PaymentReceipt;
  const hosts = receipt.hosts || [];
  if (!hosts.length) {
    console.error("No hosts in receipt");
    process.exit(1);
  }

  console.log("Verifying ENS records on Sepolia (no orchestrator)...\n");
  let allOk = true;
  for (const h of hosts) {
    const ensName = h.ens_name;
    if (!ensName) {
      console.log(`FAIL ${h.host_id || "?"}: missing ens_name in receipt`);
      allOk = false;
      continue;
    }
    const onChain = await resolveEns(ensName);
    const hederaOk = onChain[RECORD_KEYS.hederaAccountId] === h.hedera_account_id;
    const blocksOk = Boolean(onChain[RECORD_KEYS.blockIndices]);
    const ok = hederaOk && blocksOk;
    allOk = allOk && ok;
    console.log(`${ok ? "PASS" : "FAIL"} ${ensName}`);
    console.log(`  receipt hedera: ${h.hedera_account_id}`);
    console.log(`  on-chain hedera: ${onChain[RECORD_KEYS.hederaAccountId]}`);
    console.log(`  on-chain blocks: ${onChain[RECORD_KEYS.blockIndices]}`);
    console.log(`  layers paid: ${h.layers} amount: ${h.amount_tinybars} tinybars`);
    console.log();
  }

  if (receipt.payout_tx_id) {
    console.log(`HashScan payout: https://hashscan.io/testnet/transaction/${receipt.payout_tx_id}`);
  }
  if (receipt.hcs_topic_id && receipt.hcs_sequence) {
    console.log(`HCS topic ${receipt.hcs_topic_id} seq ${receipt.hcs_sequence}`);
  }

  process.exit(allOk ? 0 : 2);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
