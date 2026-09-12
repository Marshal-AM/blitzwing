import {
  DAppConnector,
  HederaChainId,
  HederaJsonRpcMethod,
  HederaSessionEvent,
} from "@hashgraph/hedera-wallet-connect";
import { LedgerId } from "@hiero-ledger/sdk";
import { connectHashpackOrModal } from "./hashpack-connect";

let connector: DAppConnector | null = null;
let initPromise: Promise<DAppConnector> | null = null;

function requireWalletConfig() {
  const projectId = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID?.trim();
  if (!projectId) {
    throw new Error(
      "VITE_WALLETCONNECT_PROJECT_ID is required — get one from https://cloud.reown.com",
    );
  }
  const network = (import.meta.env.VITE_HEDERA_NETWORK ?? "testnet") as "testnet" | "mainnet";
  return { projectId, network };
}

async function createConnector(): Promise<DAppConnector> {
  const { projectId, network } = requireWalletConfig();
  const ledger = network === "mainnet" ? LedgerId.MAINNET : LedgerId.TESTNET;
  const chain = network === "mainnet" ? HederaChainId.Mainnet : HederaChainId.Testnet;

  const metadata = {
    name: "Blitzwing",
    description: "Blitzwing distributed inference swarm console",
    url: typeof window !== "undefined" ? window.location.origin : "http://localhost:5173",
    icons: [
      typeof window !== "undefined"
        ? `${window.location.origin}/blitzwing_logo.png`
        : "http://localhost:5173/blitzwing_logo.png",
    ],
  };

  const dApp = new DAppConnector(
    metadata,
    ledger,
    projectId,
    Object.values(HederaJsonRpcMethod),
    [HederaSessionEvent.ChainChanged, HederaSessionEvent.AccountsChanged],
    [chain],
  );
  await dApp.init({ logger: "error" });
  return dApp;
}

export async function getDAppConnector(): Promise<DAppConnector> {
  if (connector) return connector;
  if (!initPromise) {
    initPromise = createConnector().then((d) => {
      connector = d;
      return d;
    });
  }
  return initPromise;
}

export async function restoreWalletSession(): Promise<string | null> {
  const dApp = await getDAppConnector();
  if (dApp.signers.length === 0) return null;
  return dApp.signers[0].getAccountId().toString();
}

export async function connectWallet(): Promise<string> {
  const dApp = await getDAppConnector();
  await connectHashpackOrModal(dApp);
  if (dApp.signers.length === 0) {
    throw new Error("No Hedera account returned from wallet");
  }
  return dApp.signers[0].getAccountId().toString();
}

export async function disconnectWallet(): Promise<void> {
  if (!connector) return;
  await connector.disconnectAll();
  connector = null;
  initPromise = null;
}

export function getConnectedAccountId(): string | null {
  if (!connector || connector.signers.length === 0) return null;
  return connector.signers[0].getAccountId().toString();
}
