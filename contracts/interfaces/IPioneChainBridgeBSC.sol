// SPDX-License-Identifier: UNLICENSED
pragma solidity >=0.8.0;

interface IPioneChainBridgeBSC {
    /**
     * @notice Returns whether the transaction identified by the given request ID has been processed.
     */
    function processedTransactions(bytes32 _requestId) external returns (bool);
}