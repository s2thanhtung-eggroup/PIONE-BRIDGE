// SPDX-License-Identifier: UNLICENSED
pragma solidity >=0.8.0;

interface IPioneChainBridge {
    /**
     * @notice Returns whether the transaction identified by the given request ID has been processed.
     */
    function processedTransactions(bytes32 _requestId) external returns (bool);

    /**
     * @notice Initiate a cross-chain transfer
     */
    function bridgeOut(
        address to,
        uint amount,
        uint targetChain
    ) external returns (bytes32);
}