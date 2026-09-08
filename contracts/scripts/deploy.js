const hre = require("hardhat");

async function main() {
  const operator = process.env.OPERATOR_EVM_ADDRESS;
  if (!operator) {
    throw new Error("Set OPERATOR_EVM_ADDRESS (mother EVM alias)");
  }
  const Escrow = await hre.ethers.getContractFactory("BlitzwingEscrow");
  const escrow = await Escrow.deploy(operator);
  await escrow.waitForDeployment();
  console.log("BlitzwingEscrow deployed:", await escrow.getAddress());
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
