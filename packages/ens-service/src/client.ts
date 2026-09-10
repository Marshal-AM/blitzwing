import {
  createPublicClient,
  createWalletClient,
  encodeAbiParameters,
  encodeFunctionData,
  http,
  keccak256,
  parseAbi,
  parseEventLogs,
  stringToHex,
  zeroAddress,
  type Address,
  type Hash,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { getResolver, getTextRecord } from "@ensdomains/ensjs/public";
import { getNameRegistryAddress } from "@ensdomains/ensjs/public/v2";
import {
  createSubnameV2,
  deploySubregistry,
  deployVerifiableProxy,
  setRecords,
  setSubregistry,
} from "@ensdomains/ensjs/wallet";
import { grantResolverRoles, setResolver } from "@ensdomains/ensjs/wallet/v2";
import { registryRoles } from "@ensdomains/ensjs/utils/v2";
import { ENS_CONFIG, SEPOLIA_V2, ensChain, requireOperatorKey } from "./config.js";
import {
  type BlitzwingHostRecord,
  RECORD_KEYS,
  hostIdToEnsName,
  hostIdToLabel,
  recordToTexts,
} from "./records.js";
import {
  getEnsNameForHost,
  loadParentBootstrap,
  saveHostMapping,
  saveParentBootstrap,
} from "./state.js";

const SUBNAME_ROLES =
  registryRoles.ROLE_REGISTRAR |
  registryRoles.ROLE_REGISTRAR_ADMIN |
  registryRoles.ROLE_RENEW |
  registryRoles.ROLE_SET_RESOLVER |
  registryRoles.ROLE_SET_SUBREGISTRY |
  registryRoles.ROLE_UNREGISTER;

/** All roles + admin counterparts (ENS docs / ensjs DEFAULT_ROLE_BITMAP). */
const ALL_ROLES =
  0x1111111111111111111111111111111111111111111111111111111111111111n;

const RESOLVER_INIT_ABI = parseAbi([
  "function initialize(address admin, uint256 roleBitmap, bytes[] setters)",
]);

const PROXY_DEPLOYED_ABI = [
  {
    type: "event",
    name: "ProxyDeployed",
    inputs: [
      { indexed: true, name: "sender", type: "address" },
      { indexed: true, name: "proxyAddress", type: "address" },
      { indexed: false, name: "salt", type: "uint256" },
      { indexed: false, name: "implementation", type: "address" },
    ],
  },
] as const;

function makePublic() {
  return createPublicClient({
    chain: ensChain(),
    transport: http(ENS_CONFIG.rpcUrl),
  });
}

function makeWallet() {
  const account = privateKeyToAccount(requireOperatorKey());
  return createWalletClient({
    account,
    chain: ensChain(),
    transport: http(ENS_CONFIG.rpcUrl),
  });
}

async function waitTx(hash: Hash): Promise<void> {
  await makePublic().waitForTransactionReceipt({ hash });
}

async function proxyFromDeploy(hash: Hash): Promise<Address> {
  const receipt = await makePublic().waitForTransactionReceipt({ hash });
  const logs = parseEventLogs({ abi: PROXY_DEPLOYED_ABI, logs: receipt.logs });
  const proxy = logs[0]?.args?.proxyAddress as Address | undefined;
  if (!proxy) throw new Error("ProxyDeployed event missing");
  return proxy;
}

function ownedResolverSalt(owner: Address, version = 0n): bigint {
  return BigInt(
    keccak256(
      encodeAbiParameters(
        [{ type: "bytes32" }, { type: "address" }, { type: "uint256" }],
        [keccak256(stringToHex("OwnedResolver")), owner, version],
      ),
    ),
  );
}

async function ensureOperatorResolver(): Promise<Address> {
  const parent = loadParentBootstrap();
  if (parent?.resolverAddress) {
    return parent.resolverAddress as Address;
  }

  const pub = makePublic();
  const existing = await getResolver(pub, { name: ENS_CONFIG.parentName });
  if (
    existing &&
    existing.toLowerCase() !== SEPOLIA_V2.permissionedResolverImpl.toLowerCase()
  ) {
    saveParentBootstrap({
      parentName: ENS_CONFIG.parentName,
      registeredAt: parent?.registeredAt || Date.now(),
      userRegistryAddress: parent?.userRegistryAddress,
      resolverAddress: existing,
    });
    return existing as Address;
  }

  const wallet = makeWallet();
  const admin = wallet.account.address;
  const callData = encodeFunctionData({
    abi: RESOLVER_INIT_ABI,
    functionName: "initialize",
    args: [admin, ALL_ROLES, []],
  });
  const deployHash = await deployVerifiableProxy(wallet, {
    factoryAddress: SEPOLIA_V2.verifiableFactory,
    implAddress: SEPOLIA_V2.permissionedResolverImpl,
    callData,
    salt: ownedResolverSalt(admin),
  });
  const resolver = await proxyFromDeploy(deployHash);

  // Ensure operator can set text records on any name via this resolver
  const grantHash = await grantResolverRoles(wallet, {
    resolverAddress: resolver,
    targetAccount: admin,
    scope: "root",
    roles: ["ROLE_SET_TEXT", "ROLE_CLEAR"],
  });
  await waitTx(grantHash);

  const parentLabel = ENS_CONFIG.parentName.replace(/\.eth$/i, "");
  const setHash = await setResolver(wallet, {
    registryAddress: SEPOLIA_V2.ethRegistry,
    label: parentLabel,
    resolverAddress: resolver,
  });
  await waitTx(setHash);

  saveParentBootstrap({
    parentName: ENS_CONFIG.parentName,
    registeredAt: parent?.registeredAt || Date.now(),
    userRegistryAddress: parent?.userRegistryAddress,
    resolverAddress: resolver,
    txHash: setHash,
  });
  return resolver;
}

async function ensureParentUserRegistry(): Promise<Address> {
  const parent = loadParentBootstrap();
  if (parent?.userRegistryAddress && parent.userRegistryAddress !== zeroAddress) {
    return parent.userRegistryAddress as Address;
  }

  const pub = makePublic();
  const parentLabel = ENS_CONFIG.parentName.replace(/\.eth$/i, "");
  const existing = await getNameRegistryAddress(pub, {
    registryAddress: SEPOLIA_V2.ethRegistry,
    label: parentLabel,
  });
  if (existing && existing !== zeroAddress) {
    saveParentBootstrap({
      parentName: ENS_CONFIG.parentName,
      registeredAt: parent?.registeredAt || Date.now(),
      userRegistryAddress: existing,
      resolverAddress: parent?.resolverAddress,
    });
    return existing;
  }

  const wallet = makeWallet();
  const deployHash = await deploySubregistry(wallet, {
    factoryAddress: SEPOLIA_V2.verifiableFactory,
    implAddress: SEPOLIA_V2.userRegistryImpl,
    adminAddress: wallet.account.address,
  });
  const proxy = await proxyFromDeploy(deployHash);

  const setHash = await setSubregistry(wallet, {
    registryAddress: SEPOLIA_V2.ethRegistry,
    label: parentLabel,
    subregistryAddress: proxy,
  });
  await waitTx(setHash);

  saveParentBootstrap({
    parentName: ENS_CONFIG.parentName,
    registeredAt: parent?.registeredAt || Date.now(),
    userRegistryAddress: proxy,
    resolverAddress: parent?.resolverAddress,
    txHash: setHash,
  });
  return proxy;
}

async function subnameExists(ensName: string): Promise<boolean> {
  try {
    const v = await getTextRecord(makePublic(), {
      name: ensName,
      key: RECORD_KEYS.hostId,
    });
    return Boolean(v);
  } catch {
    return false;
  }
}

export async function resolveHostRecord(ensName: string): Promise<BlitzwingHostRecord | null> {
  const client = makePublic();
  const texts: Record<string, string | null> = {};
  for (const key of Object.values(RECORD_KEYS)) {
    texts[key] = await getTextRecord(client, { name: ensName, key });
  }
  const hostId = texts[RECORD_KEYS.hostId];
  const hedera = texts[RECORD_KEYS.hederaAccountId];
  const blocks = texts[RECORD_KEYS.blockIndices];
  if (!hostId || !hedera || !blocks) return null;
  return {
    hostId,
    hederaAccountId: hedera,
    blockIndices: blocks,
    layersHosted: Number(texts[RECORD_KEYS.layersHosted] || "0"),
    model: texts[RECORD_KEYS.model] || "",
    role: (texts[RECORD_KEYS.role] as BlitzwingHostRecord["role"]) || "contributor",
    status: (texts[RECORD_KEYS.status] as BlitzwingHostRecord["status"]) || "offline",
  };
}

export async function provisionHost(input: {
  hostId: string;
  role: BlitzwingHostRecord["role"];
  hederaAccountId: string;
  blockIndices: string;
  layersHosted: number;
  model: string;
  status?: BlitzwingHostRecord["status"];
}): Promise<{ ensName: string; txHashes: string[] }> {
  const ensName =
    getEnsNameForHost(input.hostId) || hostIdToEnsName(input.hostId, ENS_CONFIG.parentName);
  const record: BlitzwingHostRecord = {
    hostId: input.hostId,
    role: input.role,
    hederaAccountId: input.hederaAccountId,
    blockIndices: input.blockIndices,
    layersHosted: input.layersHosted,
    model: input.model,
    status: input.status || "online",
  };

  const wallet = makeWallet();
  const txHashes: string[] = [];
  const owner = wallet.account.address;
  const label = hostIdToLabel(input.hostId);
  const resolverAddress = await ensureOperatorResolver();

  const exists = await subnameExists(ensName);
  if (!exists) {
    const userRegistry = await ensureParentUserRegistry();
    const hash = await createSubnameV2(wallet, {
      registryAddress: userRegistry,
      label,
      owner,
      subregistryAddress: zeroAddress,
      resolverAddress,
      roleBitmap: SUBNAME_ROLES,
    });
    txHashes.push(hash);
    await waitTx(hash);
  }

  const hash = await setRecords(wallet, {
    name: ensName,
    resolverAddress,
    texts: recordToTexts(record),
  });
  txHashes.push(hash);
  await waitTx(hash);

  saveHostMapping(input.hostId, ensName);
  return { ensName, txHashes };
}

export async function updateHost(input: {
  ensName: string;
  hostId?: string;
  hederaAccountId?: string;
  blockIndices?: string;
  layersHosted?: number;
  model?: string;
  role?: BlitzwingHostRecord["role"];
  status?: BlitzwingHostRecord["status"];
}): Promise<{ txHashes: string[] }> {
  const current = await resolveHostRecord(input.ensName);
  if (!current) {
    throw new Error(`Cannot update unknown ENS name: ${input.ensName}`);
  }
  const merged: BlitzwingHostRecord = {
    ...current,
    hostId: input.hostId ?? current.hostId,
    hederaAccountId: input.hederaAccountId ?? current.hederaAccountId,
    blockIndices: input.blockIndices ?? current.blockIndices,
    layersHosted: input.layersHosted ?? current.layersHosted,
    model: input.model ?? current.model,
    role: input.role ?? current.role,
    status: input.status ?? current.status,
  };

  const wallet = makeWallet();
  const resolverAddress = await ensureOperatorResolver();
  const hash = await setRecords(wallet, {
    name: input.ensName,
    resolverAddress,
    texts: recordToTexts(merged),
  });
  await waitTx(hash);
  saveHostMapping(merged.hostId, input.ensName);
  return { txHashes: [hash] };
}

export async function deactivateHost(ensName: string): Promise<{ txHashes: string[] }> {
  return updateHost({ ensName, status: "offline" });
}

export function operatorAddress(): Address {
  return privateKeyToAccount(requireOperatorKey()).address;
}
