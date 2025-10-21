const hre = require("hardhat");

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
  const TOKEN_ADDRESS = "";

  console.log("Wait before verifying");

  const [signer] = await hre.ethers.getSigners(); // owner;
  console.log('signer :>> ', signer.address);

  await verify(TOKEN_ADDRESS, "PIONECHAIN", [signer.address]);
  console.log("verify success");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
