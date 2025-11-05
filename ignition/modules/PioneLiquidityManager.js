// This setup uses Hardhat Ignition to manage smart contract deployments.
// Learn more about it at https://hardhat.org/ignition

const { buildModule } = require("@nomicfoundation/hardhat-ignition/modules");
const { ethers } = require("hardhat");
require('dotenv').config();

const PIONE_TOKEN = process.env.PIONE_TOKEN || "";

module.exports = buildModule("PioneLiquidityManager_modules", (m) => {

  const pioneToken = "0x5596800A994B0A3d1464636F386b6e7e768654CD";
  const usdtToken = "0xdC53e9229Ef15B60F88B25C7A7B0E506B6C51E43";
  const bridge = "0x79c717A9408e8e455Ff6Bbfd3Df4f140ba95B669";
  const router = "0xD99D1c33F9fC3444f8101754aBC46c52416550D1";
  const pinkLock = "0x057b7c45e8104D75b3D31b7d462E466caF37AD49";

  const liquidityManager = m.contract(
      "PioneLiquidityManager", 
      [
        pioneToken,
        usdtToken,
        bridge,
        router,
        pinkLock
      ]
    );

  return { liquidityManager };
});