const hre = require("hardhat");

const EXPLORERS = {
  11155111: "https://sepolia.etherscan.io",
};

async function main() {
  const net = await hre.ethers.provider.getNetwork();
  const chainId = Number(net.chainId);
  const [deployer] = await hre.ethers.getSigners();

  if (!deployer) {
    throw new Error(
      "No deployer account configured. Set DEPLOYER_PRIVATE_KEY in backend/.env " +
      "(a 0x-prefixed 64-hex-character key) before deploying to a public network."
    );
  }

  const balance = await hre.ethers.provider.getBalance(deployer.address);
  console.log(`[Blockchain] Network      : ${hre.network.name} (chainId ${chainId})`);
  console.log(`[Blockchain] Deployer     : ${deployer.address}`);
  console.log(`[Blockchain] Balance      : ${hre.ethers.formatEther(balance)} ETH`);

  if (balance === 0n) {
    throw new Error(
      `Deployer ${deployer.address} has 0 ETH on ${hre.network.name}. ` +
      "Fund it from a Sepolia faucet (https://sepoliafaucet.com or https://www.alchemy.com/faucets/ethereum-sepolia) and retry."
    );
  }

  console.log("[Blockchain] Deploying FaceVerification smart contract...");
  const FaceVerification = await hre.ethers.getContractFactory("FaceVerification");
  const faceVerification = await FaceVerification.deploy();
  await faceVerification.waitForDeployment();

  const contractAddress = await faceVerification.getAddress();
  const deployTx = faceVerification.deploymentTransaction();

  console.log("");
  console.log(`[Blockchain] Deployed to  : ${contractAddress}`);
  console.log(`[Blockchain] Tx hash      : ${deployTx?.hash}`);

  const explorer = EXPLORERS[chainId];
  if (explorer) {
    console.log(`[Blockchain] Explorer     : ${explorer}/address/${contractAddress}`);
  }

  console.log("");
  console.log("Next step — copy these into backend/.env:");
  console.log(`  CONTRACT_ADDRESS=${contractAddress}`);
  console.log(`  CHAIN_ID=${chainId}`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
