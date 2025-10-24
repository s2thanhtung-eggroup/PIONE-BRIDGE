# 🪩 PIONEBRIDGE

**PIONEBRIDGE** is a cross-chain bridge between **BNB Smart Chain (BSC)** and **PioneChain**, enabling seamless and secure transfers of the **PIONE** token between networks.

The bridge operates under a **mint/burn** mechanism:
- When transferring from **BSC → Pione**, tokens are **burned** on BSC and **release** on Pione.
- When transferring from **Pione → BSC**, tokens are **lock** on Pione and **minted** back on BSC.

## Requirements

- Node.js ≥ 20 (recommended)
- npm or yarn
- RPC endpoints for both BSC and PioneChain
- A valid private key in `.env` for deployment

Install dependencies:

```bash
npm install
```

Fill in your configuration:

PRIVATE_KEY=<YOUR_PRIVATE_KEY>
INFURA_KEY=<BSC_RPC_URL>
EXPLORER_API_KEY=<YOUR_API_KEY>
PIONE_TOKEN=<PIONE_TOKEN_ADDRESS> (Optional - after deployed on BSC, using for Set up tokenBridge address and unpauseTokenBridge)
PIONE_BRIDGE_BSC=<PIONEBRIDGE_BSC_ADDRESS> ((Optional - after deployed on BSC, using for Set up tokenBridge address and unpauseTokenBridge))

## Testing 

```bash
npx hardhat test
```


### 0. (Optional) Deploy the PIONE Token:

If the PIONE token has not been deployed yet, run:

```bash
npm run token:deploy-bsc
```

Record the deployed token address — it will be needed in the next step.


### 1. Deploy PioneChainBridgeBSC contract on BSC: 

Deploy the bridge contract to BNB Smart Chain:
require set: PIONE_TOKEN=<PIONE_TOKEN_ADDRESS> in .env before run

```bash
npm run deploy:bsc
```
**If verify fails, run one more time.**


### 2. Deploy PioneChainBridge contract on PioneChain:

Deploy the bridge contract on PioneChain:

```bash
npm run deploy:pione
```
**If verify fails, run one more time.**


### 3. Set up tokenBridge address and unpauseTokenBridge:

Once both contracts are deployed, update your .env file:

PIONE_TOKEN=<PIONE_TOKEN_ADDRESS> 
PIONE_BRIDGE_BSC=<PIONEBRIDGE_BSC_ADDRESS> 

Then run:
```bash
npm run token:action
```

This script will:
- Assign Minter/Burner roles to the bridge contracts.
- Unpause the bridge for active operation.
