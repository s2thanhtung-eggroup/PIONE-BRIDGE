// This setup uses Hardhat Ignition to manage smart contract deployments.
// Learn more about it at https://hardhat.org/ignition

const { buildModule } = require("@nomicfoundation/hardhat-ignition/modules");
const { ethers } = require("hardhat");


module.exports = buildModule("PIONECHAIN_modules", (m) => {
  const signer = m.getAccount(0); // owner;
  
  const token = m.contract("PIONECHAIN", [signer]);

  return { token };
});
