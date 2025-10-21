const { ethers } = require("hardhat");
require('dotenv').config();

const PIONE_TOKEN = process.env.PIONE_TOKEN || "";
const PIONE_BRIDGE_BSC = process.env.PIONE_BRIDGE_BSC || "";

async function addTokenBridge(address, pioToken) {
    try {
        const tx = await pioToken.setTokenBridge(address);
        const txReceipt = await tx.wait();
        console.log('hash :>> ', txReceipt.hash);

        const tokenBridge = await pioToken.tokenBridge();
        console.log('set token bridge address successfully !');
        console.log('tokenBridge :>> ', tokenBridge);

    } catch (error) {
        console.log('error :>> ', error);
    }
}

async function unpauseToken(pioToken) {
    try {
        const tx = await pioToken.unpauseTokenBridge();
        const txReceipt = await tx.wait();
        console.log('hash :>> ', txReceipt.hash);

        const paused = await pioToken.tokenBridgePaused();
        console.log('Unpause token bridge successfully !');
        console.log('paused :>> ', paused);
        console.log("-------------------------------------\n");
    } catch (error) {
        console.log('error :>> ', error);
    }
}


async function main() {
    const [signer] = await ethers.getSigners();
    const pioToken = await ethers.getContractAt("PIONE", PIONE_TOKEN, signer);
    await addTokenBridge(PIONE_BRIDGE_BSC, pioToken);
    await unpauseToken(pioToken);
}

main().catch((err) => {
    console.log('err :>> ', err);
    process.exit(1);
});

