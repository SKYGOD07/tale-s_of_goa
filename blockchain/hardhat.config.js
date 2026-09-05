require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config({ path: require("path").resolve(__dirname, "../backend/.env") });

const SEPOLIA_RPC_URL = process.env.SEPOLIA_RPC_URL || "";
const DEPLOYER_PRIVATE_KEY = process.env.DEPLOYER_PRIVATE_KEY || process.env.PRIVATE_KEY || "";
const ETHERSCAN_API_KEY = process.env.ETHERSCAN_API_KEY || "";

// Hardhat rejects malformed keys at load time, so only pass one through when
// it actually looks like a 32-byte hex key. Keeps `npx hardhat node` usable
// before the deployer key is filled in.
const accounts = /^0x[0-9a-fA-F]{64}$/.test(DEPLOYER_PRIVATE_KEY)
  ? [DEPLOYER_PRIVATE_KEY]
  : [];

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.20",
    settings: {
      optimizer: { enabled: true, runs: 200 },
    },
  },
  networks: {
    hardhat: {
      chainId: 31337,
    },
    localhost: {
      url: "http://127.0.0.1:8545",
      chainId: 31337,
    },
    sepolia: {
      url: SEPOLIA_RPC_URL,
      chainId: 11155111,
      accounts,
    },
  },
  etherscan: {
    apiKey: { sepolia: ETHERSCAN_API_KEY },
  },
};
