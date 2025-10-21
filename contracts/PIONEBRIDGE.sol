// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @title PIONECHAIN Token Bridge
 * @dev Cross-chain bridge for PIO tokens with role-based access control
 * 
 * Features:
 * - Role-based access control (Admin, Operator, Validator)
 * - Multi-signature validation for cross-chain transfers
 * - Configurable limits
 * - Emergency pause mechanism
 * - Nonce-based replay attack prevention
 * 
 * @company  Pione Group
 * @team     Pione Labs
 * @author   Pione Labs
 */

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IPIONECHAINToken {
    function crosschainMint(address to, uint256 amount) external;
    function crosschainBurn(address from, uint256 amount) external;
}

contract PIONECHAINBridge is AccessControl, Pausable, ReentrancyGuard {
    
    // ============ Roles ============
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");
    bytes32 public constant VALIDATOR_ROLE = keccak256("VALIDATOR_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    
    // ============ State Variables ============
    IPIONECHAINToken public pioToken;
    
    // Chain ID mapping
    uint256 public immutable CHAIN_ID;
    mapping(uint256 => bool) public supportedChains;
    
    // Transfer limits
    uint256 public minTransferAmount;
    uint256 public maxTransferAmount;
    uint256 public dailyLimit;
    mapping(address => uint256) public dailyTransferred;
    mapping(address => uint256) public lastTransferDay;
    
    // Nonce management for replay protection
    mapping(address => uint256) public userNonces;
    mapping(bytes32 => bool) public processedTransactions;
    
    // Validator consensus
    uint256 public requiredValidators;
    mapping(bytes32 => mapping(address => bool)) public validatorApprovals;
    mapping(bytes32 => uint256) public approvalCount;
    
    // ============ Structs ============
    struct BridgeRequest {
        address from;
        address to;
        uint256 amount;
        uint256 sourceChain;
        uint256 targetChain;
        uint256 nonce;
        uint256 timestamp;
    }
    
    // ============ Events ============
    event BridgeInitiated(
        bytes32 indexed requestId,
        address indexed from,
        address indexed to,
        uint256 amount,
        uint256 sourceChain,
        uint256 targetChain,
        uint256 nonce
    );
    
    event BridgeCompleted(
        bytes32 indexed requestId,
        address indexed to,
        uint256 amount,
        uint256 targetChain
    );
    
    event ValidatorApproved(
        bytes32 indexed requestId,
        address indexed validator
    );
    
    event ChainSupportUpdated(uint256 indexed chainId, bool supported);
    event TransferLimitsUpdated(uint256 minAmount, uint256 maxAmount, uint256 dailyLimit);
    event RequiredValidatorsUpdated(uint256 oldRequired, uint256 newRequired);
    
    // ============ Errors ============
    error InvalidAmount();
    error ChainNotSupported();
    error DailyLimitExceeded();
    error InsufficientValidators();
    error AlreadyProcessed();
    error InvalidRequest();
    error TransferFailed();
    
    // ============ Constructor ============
    constructor(
        address _pioToken,
        address _admin,
        uint256 _requiredValidators
    ) {
        require(_pioToken != address(0), "Invalid token address");
        require(_admin != address(0), "Invalid admin address");
        require(_requiredValidators > 0, "Invalid validator count");
        
        pioToken = IPIONECHAINToken(_pioToken);
        CHAIN_ID = block.chainid;
        requiredValidators = _requiredValidators;
        
        // Set default limits
        minTransferAmount = 1 * 10**18; // 1 PIO
        maxTransferAmount = 1_000_000 * 10**18; // 1M PIO
        dailyLimit = 10_000_000 * 10**18; // 10M PIO
        
        // Grant roles
        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        _grantRole(PAUSER_ROLE, _admin);
    }
    
    // ============ Bridge Functions ============
    
    /**
     * @notice Initiate a cross-chain transfer (lock and burn on source chain)
     * @param to Recipient address on target chain
     * @param amount Amount to bridge
     * @param targetChain Target chain ID
     */
    function bridgeOut(
        address to,
        uint256 amount,
        uint256 targetChain
    ) external whenNotPaused nonReentrant returns (bytes32) {
        require(to != address(0), "Invalid recipient");
        require(supportedChains[targetChain], "Chain not supported");
        
        // Check transfer limits
        if (amount < minTransferAmount || amount > maxTransferAmount) {
            revert InvalidAmount();
        }
        
        // Check daily limit
        uint256 today = block.timestamp / 1 days;
        if (lastTransferDay[msg.sender] != today) {
            dailyTransferred[msg.sender] = 0;
            lastTransferDay[msg.sender] = today;
        }
        
        if (dailyTransferred[msg.sender] + amount > dailyLimit) {
            revert DailyLimitExceeded();
        }
        dailyTransferred[msg.sender] += amount;
        
        // Generate request ID
        uint256 nonce = userNonces[msg.sender]++;
        bytes32 requestId = keccak256(
            abi.encodePacked(
                msg.sender,
                to,
                amount,
                CHAIN_ID,
                targetChain,
                nonce,
                block.timestamp
            )
        );
        
        // Burn tokens (will be minted on target chain)
        pioToken.crosschainBurn(msg.sender, amount);
        
        emit BridgeInitiated(
            requestId,
            msg.sender,
            to,
            amount,
            CHAIN_ID,
            targetChain,
            nonce
        );
        
        return requestId;
    }
    
    /**
     * @notice Complete a cross-chain transfer (mint on target chain)
     * @dev Requires validator approval
     */
    function bridgeIn(
        BridgeRequest calldata request,
        bytes32 requestId
    ) external onlyRole(OPERATOR_ROLE) whenNotPaused nonReentrant {
        require(request.targetChain == CHAIN_ID, "Wrong target chain");
        require(!processedTransactions[requestId], "Already processed");
        require(approvalCount[requestId] >= requiredValidators, "Insufficient approvals");
        
        // Verify request ID
        bytes32 computedId = keccak256(
            abi.encodePacked(
                request.from,
                request.to,
                request.amount,
                request.sourceChain,
                request.targetChain,
                request.nonce,
                request.timestamp
            )
        );
        require(computedId == requestId, "Invalid request");
        
        // Mark as processed
        processedTransactions[requestId] = true;
        
        // Mint tokens to recipient
        pioToken.crosschainMint(request.to, request.amount);
        
        emit BridgeCompleted(requestId, request.to, request.amount, CHAIN_ID);
    }
    
    /**
     * @notice Validator approves a bridge request
     */
    function approveRequest(bytes32 requestId) external onlyRole(VALIDATOR_ROLE) {
        require(!validatorApprovals[requestId][msg.sender], "Already approved");
        require(!processedTransactions[requestId], "Already processed");
        
        validatorApprovals[requestId][msg.sender] = true;
        approvalCount[requestId]++;
        
        emit ValidatorApproved(requestId, msg.sender);
    }
    
    // ============ Admin Functions ============
    
    /**
     * @notice Add or remove supported chain
     */
    function setChainSupport(uint256 chainId, bool supported) 
        external 
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
        uint256 _minAmount,
        uint256 _maxAmount,
        uint256 _dailyLimit
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_minAmount < _maxAmount, "Invalid limits");
        require(_dailyLimit >= _maxAmount, "Daily limit too low");
        
        minTransferAmount = _minAmount;
        maxTransferAmount = _maxAmount;
        dailyLimit = _dailyLimit;
        
        emit TransferLimitsUpdated(_minAmount, _maxAmount, _dailyLimit);
    }
    
    /**
     * @notice Update required validators
     */
    function setRequiredValidators(uint256 _required) 
        external 
        onlyRole(DEFAULT_ADMIN_ROLE) 
    {
        require(_required > 0, "Invalid count");
        uint256 oldRequired = requiredValidators;
        requiredValidators = _required;
        emit RequiredValidatorsUpdated(oldRequired, _required);
    }
    
    /**
     * @notice Pause bridge operations
     */
    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }
    
    /**
     * @notice Unpause bridge operations
     */
    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }
    
    // ============ View Functions ============
    
    /**
     * @notice Check if request has enough approvals
     */
    function hasEnoughApprovals(bytes32 requestId) external view returns (bool) {
        return approvalCount[requestId] >= requiredValidators;
    }
    
    /**
     * @notice Get user's remaining daily limit
     */
    function getRemainingDailyLimit(address user) external view returns (uint256) {
        uint256 today = block.timestamp / 1 days;
        if (lastTransferDay[user] != today) {
            return dailyLimit;
        }
        return dailyLimit - dailyTransferred[user];
    }
}