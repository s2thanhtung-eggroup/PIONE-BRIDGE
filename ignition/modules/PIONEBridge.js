// This setup uses Hardhat Ignition to manage smart contract deployments.
// Learn more about it at https://hardhat.org/ignition

const { buildModule } = require("@nomicfoundation/hardhat-ignition/modules");
const { ethers } = require("hardhat");

module.exports = buildModule("PIONEBridge_modules", (m) => {

  const minTransfer = ethers.parseEther("1"); // 1 PIO
  const maxTransfer = ethers.parseEther("10000"); // 100K PIO
  const dailyLimit = ethers.parseEther("1000000"); // 1M PIO
  const chainSupport = 56; // Pione 5090 => BSC 56

  const bridge = m.contract(
      "PIONEBridge", 
      [
        minTransfer,
        maxTransfer,
        dailyLimit,
        chainSupport
      ]
    );

  return { bridge };
});
