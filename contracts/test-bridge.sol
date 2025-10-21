// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @title PioneBridge
 * @notice Official bridge contract for the PIONECHAIN (PIO) token.
 * 
 * @dev
 *  - Handles cross-chain mint/burn for PIO.
 *  - Supports admin minting by contract owner.
 *  - Prevents double mint via processedTx mapping.
 *  - Includes signature validation using ECDSA.
 *  - Fully pausable for security.
 * 
 * @company  Pione Group
 * @team     Pione Labs
 * @contact  info@pionegroup.com
 * @author   Pione Labs
 */

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

interface IPioneBridgeableToken {
    function crosschainBurn(address _from, uint256 _value) external;
    function crosschainMint(address _to, uint256 _value) external;
    function MAX_SUPPLY() external view returns (uint256);
}

contract PioneBridge is Ownable {
    using ECDSA for bytes32;

    IPioneBridgeableToken public token;
    address public validator;       // Off-chain signer for mint authorization
    bool public paused;

    uint256 private _nonce;
    mapping(bytes32 => bool) public processedTx;

    // -------- Events --------
    event BridgeBurned(bytes32 indexed txId, address indexed from, address indexed to, uint256 amount, uint256 destChainId);
    event BridgeMinted(bytes32 indexed txId, address indexed to, uint256 amount, uint256 srcChainId);
    event AdminMint(address indexed to, uint256 amount, address indexed admin);
    event ValidatorUpdated(address indexed oldValidator, address indexed newValidator);
    event TokenUpdated(address indexed oldToken, address indexed newToken);
    event Paused(address account);
    event Unpaused(address account);

    // -------- Errors --------
    error InvalidSignature();
    error AlreadyProcessed();
    error BridgePaused();
    error InvalidParams();

    constructor(address token_, address validator_) {
        require(token_ != address(0), "token_ zero");
        require(validator_ != address(0), "validator_ zero");

        token = IPioneBridgeableToken(token_);
        validator = validator_;
        paused = false;
        _nonce = 0;
    }

    // ------------------------------------------------------
    // 🔥 Cross-chain burn on source chain
    // ------------------------------------------------------
    function burnToChain(
        uint256 amount,
        uint256 destChainId,
        address destRecipient
    ) external returns (bytes32 txId) {
        if (paused) revert BridgePaused();
        if (amount == 0 || destRecipient == address(0)) revert InvalidParams();

        txId = keccak256(abi.encodePacked(msg.sender, destRecipient, amount, destChainId, block.number, _nonce, address(this)));
        _nonce++;

        token.crosschainBurn(msg.sender, amount);

        emit BridgeBurned(txId, msg.sender, destRecipient, amount, destChainId);
        return txId;
    }

    // ------------------------------------------------------
    // ✅ Cross-chain finalize mint on destination chain
    function finalizeMint(
        bytes32 txId,
        address to,
        uint256 amount,
        uint256 srcChainId,
        bytes calldata signature
    ) external returns (bool) {
        if (paused) revert BridgePaused();
        if (txId == bytes32(0) || to == address(0) || amount == 0) revert InvalidParams();
        if (processedTx[txId]) revert AlreadyProcessed();

        bytes32 payload = keccak256(abi.encodePacked(txId, to, amount, srcChainId, address(this)));
        bytes32 ethMessage = ECDSA. toEthSignedMessageHash(payload);
        address signer = ECDSA.recover(ethMessage, signature);
        if (signer != validator) revert InvalidSignature();

        processedTx[txId] = true;
        token.crosschainMint(to, amount);

        emit BridgeMinted(txId, to, amount, srcChainId);
        return true;
    }

    // ------------------------------------------------------
    // 🛠️ Admin Mint (manual mint by owner)
    // ------------------------------------------------------
    /**
     * @notice Allows admin to mint directly (outside of cross-chain process)
     * @dev    Only owner can call this. Use with caution.
     */
    function adminMint(address to, uint256 amount) external onlyOwner {
        if (paused) revert BridgePaused();
        require(to != address(0), "Invalid to");
        require(amount > 0, "Invalid amount");

        token.crosschainMint(to, amount);
        emit AdminMint(to, amount, _msgSender());
    }

    // ------------------------------------------------------
    // ⚙️ Admin control
    // ------------------------------------------------------
    function setValidator(address newValidator) external onlyOwner {
        require(newValidator != address(0), "validator zero");
        emit ValidatorUpdated(validator, newValidator);
        validator = newValidator;
    }

    function setToken(address newToken) external onlyOwner {
        require(newToken != address(0), "token zero");
        emit TokenUpdated(address(token), newToken);
        token = IPioneBridgeableToken(newToken);
    }

    function pause() external onlyOwner {
        paused = true;
        emit Paused(_msgSender());
    }

    function unpause() external onlyOwner {
        paused = false;
        emit Unpaused(_msgSender());
    }

    function markProcessed(bytes32 txId) external onlyOwner {
        require(txId != bytes32(0), "txId zero");
        processedTx[txId] = true;
    }
}
