// This setup uses Hardhat Ignition to manage smart contract deployments.
// Learn more about it at https://hardhat.org/ignition

const { buildModule } = require("@nomicfoundation/hardhat-ignition/modules");
const { ethers } = require("hardhat");


module.exports = buildModule("PIONE_modules", (m) => {
  const signer = m.getAccount(0); // owner;

  console.log('signer :>> ', signer);
  const token = m.contract("PIONE", [signer]);

  return { token };
});
