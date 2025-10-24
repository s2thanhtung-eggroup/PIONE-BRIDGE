// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @title Pione Chain Bridge on BSC
 * @dev Cross-chain bridge for PIO tokens with role-based access control
 * 
 * Features:
 * - Role-based access control (Admin, Operator)
 * - Configurable limits
 * - Emergency pause mechanism
 * - Nonce-based replay attack prevention
 * 
 * @company  Pione Group
 * 
 * @author   Pione Labs
 */

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IPIONE} from "./interfaces/IPIONE.sol";

contract PioneChainBridgeBSC is AccessControl, Pausable, ReentrancyGuard {
    // Role used to authorize off-chain operators who can finalize incoming
    // cross-chain requests (i.e. mint tokens on this chain).
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");
    
    IPIONE public pioToken;
    uint public immutable CHAIN_ID;

    // Map of chain IDs that are allowed as bridge targets.
    mapping(uint => bool) public supportedChains;

    // Transfer limit configuration (can be 0 to disable a check):
    uint public minTransferAmount; // Smallest allowed amount for a bridge transfer
    uint public maxTransferAmount; // Largest allowed amount for a bridge transfer
    uint public dailyLimit; // aggregate per-day cap for outgoing transfers

    // Tracks which day index (days since epoch) we last updated and the
    // amount transferred during that day. These are used to enforce
    // `dailyLimit` and reset on new days.
    uint private _lastTransferDay;
    uint private _dailyTransferred;

    // Nonce management per user to ensure uniqueness of outgoing requests
    mapping(address => uint) private _userNonces;

    // Record of processed incoming requests to guarantee idempotence.
    mapping(bytes32 => bool) private _processedTransactions;

    // Canonical representation of an incoming bridge request.
    struct BridgeRequest {
        address from;
        address to;
        uint amount;
        uint sourceChain;
        uint targetChain;
        uint nonce;
    }

    // Emitted when a user initiates a cross-chain transfer (burn on this
    // chain). Consumers can index `requestId` to follow the lifecycle.
    event BridgeInitiated(bytes32 indexed requestId, address indexed from, address indexed to, uint amount, uint sourceChain, uint targetChain, uint nonce);

    // Emitted when an incoming transfer is completed (tokens minted to the recipient on this chain).
    event BridgeCompleted(bytes32 indexed requestId, address indexed to, uint amount, uint targetChain);

    // Emitted when admin updates supported chain status.
    event ChainSupportUpdated(uint indexed chainId, bool supported);

    // Emitted when transfer policy limits are updated by an admin.
    event TransferLimitsUpdated(uint minAmount, uint maxAmount, uint dailyLimit);
    
    // ============ Errors ============
    /// @notice Emitted when a transfer amount is outside configured bounds
    error InvalidAmount(uint minAmount, uint maxAmount, uint bridgeOutAmount);
    /// @notice Emitted when the operation would exceed the configured daily aggregate limit
    error DailyLimitExceeded();
    /// @notice Emitted when the provided bridge request data is malformed or does not match its id
    error InvalidRequest();
    
    constructor(
        address _pioToken,
        uint _minTransferAmount,
        uint _maxTransferAmount,
        uint _dailyLimit,
        uint _chainSupport
    ) {
        require(_pioToken != address(0), "Invalid token address");
        pioToken = IPIONE(_pioToken);
        CHAIN_ID = block.chainid;
        
        // Set default limits
        minTransferAmount = _minTransferAmount;
        maxTransferAmount = _maxTransferAmount;
        dailyLimit = _dailyLimit;
        
        _grantRole(DEFAULT_ADMIN_ROLE, _msgSender());
        _grantRole(OPERATOR_ROLE, _msgSender());

        // Enable a default external chain in the supported list. 
        setChainSupport(_chainSupport, true);
    }
    
    /**
     * @notice Initiate a cross-chain transfer
     */
    function bridgeOut(
        address to,
        uint amount,
        uint targetChain
    ) external whenNotPaused nonReentrant returns (bytes32) {
        require(to != address(0), "Invalid recipient");
        require(supportedChains[targetChain], "Chain not supported");
        
        // Check transfer limits
        if (
            (minTransferAmount > 0 && amount < minTransferAmount) ||
            (maxTransferAmount > 0 && amount > maxTransferAmount)
        ) {
            revert InvalidAmount(minTransferAmount, maxTransferAmount, amount);
        }
        
        if(dailyLimit > 0) _updateDailyTransferred(amount);
        
        // Generate request ID
        address _sender = _msgSender();
        uint nonce = _userNonces[_sender]++;
        bytes32 requestId = keccak256(
            abi.encodePacked(
                _sender,
                to,
                amount,
                CHAIN_ID,
                targetChain,
                nonce
            )
        );

        // Burn tokens on the source chain. 
        pioToken.crosschainBurn(_sender, amount);
        
        emit BridgeInitiated(requestId, _sender, to, amount, CHAIN_ID, targetChain, nonce);
        return requestId;
    }
    
    /**
     * @notice Complete a cross-chain transfer
     */
    function bridgeIn(
        BridgeRequest calldata request,
        bytes32 requestId
    ) external onlyRole(OPERATOR_ROLE) whenNotPaused nonReentrant {
        require(request.targetChain == CHAIN_ID, "Wrong target chain");
        require(!_processedTransactions[requestId], "Already processed");
        
        bytes32 computedId = keccak256(
            abi.encodePacked(
                request.from,
                request.to,
                request.amount,
                request.sourceChain,
                request.targetChain,
                request.nonce
            )
        );
        if(computedId != requestId) revert InvalidRequest();
        _processedTransactions[requestId] = true;

        // Mint tokens to the recipient on this chain. 
        pioToken.crosschainMint(request.to, request.amount);
        
        emit BridgeCompleted(requestId, request.to, request.amount, CHAIN_ID);
    }
    
    function _updateDailyTransferred(uint amount) internal {
        uint today = block.timestamp / 1 days;
        if (_lastTransferDay != today) {
            _dailyTransferred = 0;
            _lastTransferDay = today;
        }
        if (_dailyTransferred + amount > dailyLimit) {
            revert DailyLimitExceeded();
        }
        _dailyTransferred += amount;
    }

    /**
     * @notice Add or remove supported chain
     */
    function setChainSupport(uint chainId, bool supported) 
        public 
        onlyRole(DEFAULT_ADMIN_ROLE) 
    {
        require(chainId != CHAIN_ID, "Cannot modify current chain");

        supportedChains[chainId] = supported;
        emit ChainSupportUpdated(chainId, supported);
    }
    
    /**
     * @notice Update transfer limits
     */
    function setTransferLimits(
        uint _minAmount,
        uint _maxAmount,
        uint _dailyLimit
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        minTransferAmount = _minAmount;
        maxTransferAmount = _maxAmount;
        dailyLimit = _dailyLimit;
        
        emit TransferLimitsUpdated(_minAmount, _maxAmount, _dailyLimit);
    }

    /**
     * @notice Returns whether the transaction identified by the given request ID has been processed.
     */
    function processedTransactions(bytes32 _requestId) external view returns (bool) {
        return _processedTransactions[_requestId];
    }
    
    /**
     * @notice Pause bridge operations
     */
    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }
    
    /**
     * @notice Unpause bridge operations
     */
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }
    
    /**
     * @notice Returns the remaining amount that may be bridged out today.
     * @dev If no `dailyLimit` is configured (>0) this function will revert.
     * The returned value accounts for resets at the day boundary (UTC days
     * derived from block.timestamp / 1 days).
     */
    function getRemainingDailyLimit() external view returns (uint) {
        require(dailyLimit > 0, "no limit");
        uint today = block.timestamp / 1 days;
        if (_lastTransferDay != today) {
            return dailyLimit;
        }
        return dailyLimit - _dailyTransferred;
    }

    /** 
     * @notice Returns the total amount of tokens transferred during the current day via the bridge.
     */
    function getDailyTransferred() external view returns (uint) {
        return _dailyTransferred;
    }
}