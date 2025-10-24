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
  const PioneChainBridgeAddress = "0x5f101c442EE995Fb36725A043c82461aF34b2937";

  const minTransfer = ethers.parseEther("1"); // 1 PIO
  const maxTransfer = ethers.parseEther("0"); // 0 PIO => unlimit
  const dailyLimit = ethers.parseEther("0"); // 0 PIO => unlimit
  const chainSupport = 56; // Pione 5090 => BSC 56

  console.log("Wait before verifying");

  await verify(
    PioneChainBridgeAddress,
    "PioneChainBridge",
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
