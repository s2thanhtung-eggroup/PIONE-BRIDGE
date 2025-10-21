const hre = require("hardhat");
const { ethers } = require("hardhat");

async function verify(address, contractName, args) {
  console.log("verifing...");
  await hre.run("verify:verify", {
    address: address,
    constructorArguments: [...args],
    contract: `contracts/${contractName}.sol:${contractName}`,
  });
  console.log(`verify ${contractName} success fully!!`);
  console.log("----------------");
}

async function main() {
  const PIONEBridgeAddress = "";

  const minTransfer = ethers.parseEther("1"); // 1 PIO
  const maxTransfer = ethers.parseEther("10000"); // 100K PIO
  const dailyLimit = ethers.parseEther("1000000"); // 1M PIO
  const chainSupport = 97; // Pione Testnet => BSC testnet 97

  console.log("Wait before verifying");

  const [signer] = await hre.ethers.getSigners(); // owner;
  console.log('signer :>> ', signer.address);

  await verify(
    PIONEBridgeAddress,
    "PIONEBridge",
    [
      minTransfer,
      maxTransfer,
      dailyLimit,
      chainSupport
    ]
  );
  console.log("verify success");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
