require("@nomicfoundation/hardhat-toolbox");

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: "0.8.20",
  networks: {
    hedera_testnet: {
      url: process.env.HEDERA_JSON_RPC_URL || "https://testnet.hashio.io/api",
      accounts: process.env.MOTHER_PRIVATE_KEY ? [process.env.MOTHER_PRIVATE_KEY] : [],
    },
  },
};
