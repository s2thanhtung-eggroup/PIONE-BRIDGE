# PIONECHAIN Token

This repository contains a Hardhat-based Solidity project for the Pione chain token and related smart contracts. It includes source contracts, build artifacts, tests, and Ignition deployment journals for example networks.

This README covers quick setup, common commands, where to find contracts and deployment artifacts, and notes for verification and testing.

## Project contents

- Contracts (source): `contracts/`
	- `PIONECHAIN.sol` — main chain contract / module (project-specific)
- Tests: `test/` (contains `PIONECHAIN.js` test file)
- Ignition deployments: `ignition/deployments/` (includes example journals and deployed addresses for chains)
- Artifacts and build outputs: `artifacts/`, `cache/`, and `build-info/`
- Deployment helper: `scripts/verify.js` (single-file verification helper)

## Requirements

- Node >= 20 (recommended) and npm/yarn
- Hardhat (installed as a project dependency)
- Optional: an Ethereum account mnemonic and RPC endpoints for public testnets/mainnet

Install dependencies:

```bash
npm install
```
