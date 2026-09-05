const hre = require("hardhat");

// Quick preflight: confirms the RPC URL and deployer key in backend/.env are
// wired up and the account actually holds testnet ETH before you try to deploy.
async function main() {
  const net = await hre.ethers.provider.getNetwork();
  const [deployer] = await hre.ethers.getSigners();

  console.log(`Network : ${hre.network.name} (chainId ${net.chainId})`);
  console.log(`Block   : ${await hre.ethers.provider.getBlockNumber()}`);

  if (!deployer) {
    console.log("Account : (none configured — set DEPLOYER_PRIVATE_KEY in backend/.env)");
    return;
  }

  const balance = await hre.ethers.provider.getBalance(deployer.address);
  console.log(`Account : ${deployer.address}`);
  console.log(`Balance : ${hre.ethers.formatEther(balance)} ETH`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
