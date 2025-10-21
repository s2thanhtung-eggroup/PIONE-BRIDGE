// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;


// PIONE Token Interface
interface IPIONE {
    /**
     * @notice Mints PIO tokens on destination chain during cross-chain transfer.
     * @param to The recipient address on destination chain.
     * @param amount The number of tokens to mint.
     */
    function crosschainMint(address to, uint256 amount) external;

    /**
     * @notice Burns PIO tokens on source chain during cross-chain transfer.
     * @param from The sender address on source chain.
     * @param amount The number of tokens to burn.
     */
    function crosschainBurn(address from, uint256 amount) external;

    /**
     * @notice Returns the address of the authorized token bridge.
     */
    function tokenBridge() external view returns (address);

    /**
     * @notice Returns whether the bridge operations are currently paused.
     */
    function tokenBridgePaused() external view returns (bool);
}
