/**
 * Register parent .eth on Sepolia ENSv2 Beta (MockUSDC rent + ETH gas).
 */
import {
  createPublicClient,
  createWalletClient,
  erc20Abi,
  http,
  maxUint256,
  parseAbi,
  zeroAddress,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { getAvailable } from "@ensdomains/ensjs/public";
import { getRegisterPrice, getOwner } from "@ensdomains/ensjs/public/v2";
import { randomSecret } from "@ensdomains/ensjs/utils";
import { commitName, registerName } from "@ensdomains/ensjs/wallet";
import {
  ENS_CONFIG,
  MOCK_USDC_ADDRESS,
  SEPOLIA_V2,
  ensChain,
  requireOperatorKey,
} from "./config.js";
import { saveParentBootstrap } from "./state.js";

const ONE_YEAR = 365 * 24 * 60 * 60;

async function main() {
  const parent = ENS_CONFIG.parentName;
  const label = parent.replace(/\.eth$/i, "");
  const account = privateKeyToAccount(requireOperatorKey());
  const chain = ensChain();
  const pub = createPublicClient({ chain, transport: http(ENS_CONFIG.rpcUrl) });
  const wallet = createWalletClient({
    account,
    chain,
    transport: http(ENS_CONFIG.rpcUrl),
  });

  try {
    const owner = await getOwner(pub, { name: parent });
    if (owner && owner.toLowerCase() === account.address.toLowerCase()) {
      console.log(`Parent ${parent} already owned by operator`);
      saveParentBootstrap({ parentName: parent, registeredAt: Date.now() });
      return;
    }
  } catch {
    /* name may be unregistered */
  }

  const available = await getAvailable(pub, { name: parent });
  if (!available) {
    throw new Error(`${parent} is not available — try ENS_PARENT_NAME=blitzwingsep.eth`);
  }

  const balance = await pub.getBalance({ address: account.address });
  console.log(`Operator ${account.address} ETH: ${balance}`);

  const mintHash = await wallet.writeContract({
    address: MOCK_USDC_ADDRESS,
    abi: parseAbi(["function mint(address to, uint256 amount)"]),
    functionName: "mint",
    args: [account.address, 1_000_000_000n],
  });
  await pub.waitForTransactionReceipt({ hash: mintHash });
  console.log("Minted MockUSDC", mintHash);

  const approveHash = await wallet.writeContract({
    address: MOCK_USDC_ADDRESS,
    abi: erc20Abi,
    functionName: "approve",
    args: [SEPOLIA_V2.ethRegistrar, maxUint256],
  });
  await pub.waitForTransactionReceipt({ hash: approveHash });
  console.log("Approved ETHRegistrar for MockUSDC", approveHash);

  const secret = randomSecret();
  const params = {
    label,
    owner: account.address,
    duration: ONE_YEAR,
    secret,
    paymentToken: MOCK_USDC_ADDRESS,
    subregistryAddress: zeroAddress,
  };

  const price = await getRegisterPrice(pub, {
    registrarAddress: SEPOLIA_V2.ethRegistrar,
    label,
    duration: BigInt(ONE_YEAR),
    paymentToken: MOCK_USDC_ADDRESS,
  });
  console.log(`Register price base=${price.base} premium=${price.premium}`);

  const commitHash = await commitName(wallet, params);
  await pub.waitForTransactionReceipt({ hash: commitHash });
  console.log("Committed", commitHash);
  console.log("Waiting 65s for commit reveal window...");
  await new Promise((r) => setTimeout(r, 65_000));

  const regHash = await registerName(wallet, params);
  await pub.waitForTransactionReceipt({ hash: regHash });
  console.log(`Registered ${parent}`, regHash);
  saveParentBootstrap({ parentName: parent, txHash: regHash, registeredAt: Date.now() });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
