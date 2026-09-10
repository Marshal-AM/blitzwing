import path from "node:path";
import os from "node:os";
import { config as loadDotenv } from "dotenv";
import type { Address, Chain } from "viem";
import { sepolia } from "viem/chains";
import { addEnsL1Contracts } from "@ensdomains/ensjs";

loadDotenv({ path: path.resolve(process.cwd(), "../../.env") });
loadDotenv();

export const SEPOLIA_CHAIN_ID = 11155111;

/** Current Sepolia ENSv2 Beta addresses (docs.ens.domains/learn/deployments). */
export const SEPOLIA_V2 = {
  ethRegistrar: "0xa88553f454b77203b0d036a05c894d555eaaa2cc" as Address,
  mockUsdc: "0x768f42455a2d082e23ceef7d51e5787c82d67a39" as Address,
  ethRegistry: "0xbdc85dd5b15d7ecb354cd7cb6f2c50b4f2c4f0e2" as Address,
  rootRegistry: "0x8115186e8f2e0b0281e86ab91f0f48ba90364354" as Address,
  universalResolver: "0xeEeEEEeE14D718C2B47D9923Deab1335E144EeEe" as Address,
  permissionedResolverImpl: "0x9eae5c2730a7dd16bdd1dee6421a1b91e3b0365e" as Address,
  userRegistryImpl: "0x624a25d67b59d587752ebec8dded8827dae52050" as Address,
  verifiableFactory: "0x10dc6333cdfe1fcef624c6e0a8221b91804cd7ef" as Address,
} as const;

export const MOCK_USDC_ADDRESS = (
  process.env.ENS_MOCK_USDC_ADDRESS || SEPOLIA_V2.mockUsdc
) as Address;

export const ENS_CONFIG = {
  parentName: (process.env.ENS_PARENT_NAME || "blitzwing.eth").toLowerCase(),
  rpcUrl:
    process.env.ENS_SEPOLIA_RPC_URL ||
    process.env.SEPOLIA_RPC_URL ||
    "https://ethereum-sepolia-rpc.publicnode.com",
  operatorPrivateKey: (process.env.ENS_OPERATOR_PRIVATE_KEY || "") as `0x${string}`,
  port: Number(process.env.ENS_SERVICE_PORT || "8792"),
  stateDir: process.env.BLITZWING_HOME || path.join(os.homedir(), ".blitzwing"),
};

export function requireOperatorKey(): `0x${string}` {
  const key = ENS_CONFIG.operatorPrivateKey;
  if (!key || key.length < 10) {
    throw new Error("ENS_OPERATOR_PRIVATE_KEY is required");
  }
  return key.startsWith("0x") ? key : (`0x${key}` as `0x${string}`);
}

/** Sepolia chain with ENSv2 Beta contracts (docs addresses override library pins). */
export function ensChain(): Chain {
  const base = addEnsL1Contracts(sepolia);
  return {
    ...base,
    contracts: {
      ...base.contracts,
      // ensjs v5 actions look up ethRegistrar / usdc
      ethRegistrar: { address: SEPOLIA_V2.ethRegistrar },
      usdc: { address: MOCK_USDC_ADDRESS },
      ensEthRegistrar: { address: SEPOLIA_V2.ethRegistrar },
      ensRegistry: { address: SEPOLIA_V2.ethRegistry },
      ensUniversalResolver: { address: SEPOLIA_V2.universalResolver },
      ensPermissionedResolverImpl: { address: SEPOLIA_V2.permissionedResolverImpl },
      ensUserRegistryImpl: { address: SEPOLIA_V2.userRegistryImpl },
      ensVerifiableFactory: { address: SEPOLIA_V2.verifiableFactory },
    },
  } as Chain;
}
