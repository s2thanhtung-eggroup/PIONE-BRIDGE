// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import { AccessControl } from "@openzeppelin/contracts/access/AccessControl.sol";
import { Pausable } from "@openzeppelin/contracts/utils/Pausable.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { IPancakeRouter02 } from "./interfaces/IPancakeRouter02.sol";
import { IPioneChainBridge } from "./interfaces/IPioneChainBridge.sol";
import { IPancakePair } from "./interfaces/IPancakePair.sol";
import { IPinkLock } from "./interfaces/IPinkLock.sol";


interface IUniswapV2Factory {
    function getPair(address tokenA, address tokenB) external view returns (address pair);
}


contract PioneLiquidityManager is AccessControl, Pausable, ReentrancyGuard {

    using SafeERC20 for IERC20;
    IPancakeRouter02 public router;

    bytes32 public constant MANAGER_ROLE = keccak256("MANAGER_ROLE");
    address public immutable PIONE_TOKEN;
    address public immutable USDT_TOKEN;
    address public PIONE_BRIDGE;
    address public PINK_LOCK;


    struct Transaction {
        uint256 pioAmount;
        uint256 usdtAmount;
        uint256 liquidityAmount;
        bool depositUSDT;
        uint256 pinkLockId;
    }
    
    struct UserInfo {
        uint256 pioBalance;          
        uint256 usdtBalance;            
        uint256 totalLiquidity;    
        Transaction[] transactions;
        mapping(bytes32 requestId => uint256) _positions;
    }

    // {"l":"PIO LP Locker `6 kí tư cuối ví user`"}
    uint256 private _lockTimePeriod;
    mapping(address => UserInfo) private _userData;
    mapping(bytes32 => bool) private _usedRequestIds;

    event UserDepositUSDT(bytes32 indexed requestId, address indexed user, uint256 amount);
    event BridgeCompleted(bytes32 indexed requestId, address indexed user, uint256 index);
    event ClaimedPIOtoPioneChain(bytes32 indexed requestId, address indexed user, uint256 amount);
    event ClaimedUSDT(address indexed account, uint256 amount);

    event LiquidityAdded(
        address indexed user,
        bytes32 indexed requestId,
        uint256 pioneAmount,
        uint256 usdtAmount,
        uint256 liquidity,
        uint256 slippage
    );
    event LiquidityLocked(
        address indexed user,
        bytes32 indexed requestId,
        uint256 lockId,
        uint256 liquidity,
        uint256 unlockDate
    );
    event EmergencyWithdraw(address indexed token, uint256 amount);
    
    modifier onlyOwner() {
        require(hasRole(DEFAULT_ADMIN_ROLE, msg.sender), "Not owner");
        _;
    }

    modifier onlyManager() {
        require(hasRole(MANAGER_ROLE, msg.sender), "Not manager");
        _;
    }
    
    modifier canDeposit(bytes32 _requestId) {
        require(_usedRequestIds[_requestId], "RequestId does not exist");
        UserInfo storage user = _userData[msg.sender];
        uint256 position = user._positions[_requestId];

        require(user.transactions[position].usdtAmount > 0, "Invalid transaction");
        require(!user.transactions[position].depositUSDT, "Already deposited USDT");
        _;
    }

    modifier canExecuted(bytes32 _requestId, address account) {
        require(_usedRequestIds[_requestId], "RequestId does not exist");
        UserInfo storage user = _userData[account];
        uint256 position = user._positions[_requestId];

        require(user.transactions[position].liquidityAmount == 0, "Additional liquidity request made");
        require(user.transactions[position].depositUSDT, "USDT not provided yet");
        _;
    }

    constructor(
        address _pioneToken,
        address _usdtToken,
        address _pioneBridge
    ) {
        require(_pioneToken != address(0), "Invalid PIONE address");
        require(_usdtToken != address(0), "Invalid USDT address");
        PIONE_TOKEN = _pioneToken;
        USDT_TOKEN = _usdtToken;
        PIONE_BRIDGE = _pioneBridge;
        PINK_LOCK = 0x407993575c91ce7643a4d4cCACc9A98c36eE1BBE;

        _lockTimePeriod = 30 days * 6; // default 6 months
        router = IPancakeRouter02(0x10ED43C718714eb63d5aA57B78B54704E256024E);
        IERC20(PIONE_TOKEN).approve(address(router), type(uint256).max);
        IERC20(USDT_TOKEN).approve(address(router), type(uint256).max);

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(MANAGER_ROLE, msg.sender);
    }
    
    function handleBridgeCompleted(bytes32 requestId, address account, uint256 amountPIO, uint256 amountUSDT)
        external
        onlyManager
        whenNotPaused
    {
        require(IPioneChainBridge(PIONE_BRIDGE).processedTransactions(requestId), "Transaction not completed");
        require(!_usedRequestIds[requestId], "RequestId already set");

        UserInfo storage userInfo = _userData[account];
        Transaction memory newTransaction = Transaction({
            pioAmount: amountPIO,
            usdtAmount: amountUSDT,
            liquidityAmount: 0,
            depositUSDT: false,
            pinkLockId: 0
        });
        _usedRequestIds[requestId] = true;

        uint256 index = userInfo.transactions.length;
        userInfo._positions[requestId] = index;
        userInfo.transactions.push(newTransaction);
        userInfo.pioBalance += amountPIO;

        emit BridgeCompleted(requestId, account, index);
    }
    
    function depositUSDT(bytes32 requestId)
        external
        nonReentrant
        whenNotPaused
        canDeposit(requestId)
    {
        UserInfo storage user = _userData[msg.sender];
        uint256 position = user._positions[requestId];
        uint256 usdtAmount = user.transactions[position].usdtAmount;

        // Transfer USDT từ user vào contract
        IERC20(USDT_TOKEN).safeTransferFrom(msg.sender, address(this), usdtAmount);

        user.transactions[position].depositUSDT = true;
        user.usdtBalance += usdtAmount;

        emit UserDepositUSDT(requestId, msg.sender, usdtAmount);
    }
    
    function addLiquidity(
        bytes32 requestId,
        address account,
        uint256 slippagePercent
    ) external onlyManager whenNotPaused canExecuted(requestId, account) {
        UserInfo storage user = _userData[account];
        uint256 position = user._positions[requestId];

        require(slippagePercent <= 50, "Slippage too high");
        (uint256 pioAmount, uint256 usdtAmount) = _validateAndGetAmounts(user, position);
        // Add liquidity và nhận LP tokens
        uint256 liquidity = _executeAddLiquidity(
            user,
            position,
            pioAmount,
            usdtAmount,
            slippagePercent,
            account,
            requestId
        );

        _lockLPTokens(user, position, liquidity, account, requestId);
    }

    function _executeAddLiquidity(
        UserInfo storage user,
        uint256 position,
        uint256 pioAmount,
        uint256 usdtAmount,
        uint256 slippagePercent,
        address account,
        bytes32 requestId
    ) private returns (uint256 liquidity) {
        uint256 amountPioMin = pioAmount * (100 - slippagePercent) / 100;
        uint256 amountUsdtMin = usdtAmount * (100 - slippagePercent) / 100;

        // Deduct balances first
        user.pioBalance -= pioAmount;
        user.usdtBalance -= usdtAmount;

        (uint amountA, uint amountB, uint liquidityAmount) = router.addLiquidity(
            PIONE_TOKEN,
            USDT_TOKEN,
            pioAmount,
            usdtAmount,
            amountPioMin,
            amountUsdtMin,
            address(this),
            block.timestamp + 300
        );

        // Update transaction and refund unused tokens
        user.transactions[position].liquidityAmount = liquidityAmount;
        user.totalLiquidity += liquidityAmount;

        if (pioAmount > amountA) user.pioBalance += (pioAmount - amountA);
        if (usdtAmount > amountB) user.usdtBalance += (usdtAmount - amountB);

        emit LiquidityAdded(account, requestId, amountA, amountB, liquidityAmount, slippagePercent);
        
        return liquidityAmount;
    }

    function _validateAndGetAmounts(UserInfo storage user, uint256 position)
        private
        view
        returns (uint256 pioAmount, uint256 usdtAmount)
    {
        pioAmount = user.transactions[position].pioAmount;
        usdtAmount = user.transactions[position].usdtAmount;
        
        require(user.pioBalance >= pioAmount, "Insufficient PIONE");
        require(user.usdtBalance >= usdtAmount, "Insufficient USDT");
    }

    function _lockLPTokens(
        UserInfo storage user,
        uint256 position,
        uint256 liquidity,
        address account,
        bytes32 requestId
    ) private {
        address lpToken = IUniswapV2Factory(router.factory()).getPair(PIONE_TOKEN, USDT_TOKEN);
        require(lpToken != address(0), "LP token not found");

        // Approve and lock
        IERC20(lpToken).approve(PINK_LOCK, liquidity);
        
        uint256 unlockDate = block.timestamp + _lockTimePeriod;
        string memory description = string(abi.encodePacked("PIO LP Locker ", _getLastSixChars(account)));

        uint256 lockId = IPinkLock(PINK_LOCK).lock(
            account,
            lpToken,
            true,
            liquidity,
            unlockDate,
            description
        );

        user.transactions[position].pinkLockId = lockId;

        emit LiquidityLocked(account, requestId, lockId, liquidity, unlockDate);
    }
    
    function claimUSDT(uint256 amount) external nonReentrant whenNotPaused returns (bool) {

        require(amount > 0, "invalid amount");
        UserInfo storage user = _userData[msg.sender];
        require(user.usdtBalance >= amount, "Insufficient balance USDT");
        user.usdtBalance -= amount;

        // Transfer USDT từ contract về ví user
        IERC20(USDT_TOKEN).safeTransfer(msg.sender, amount);

        emit ClaimedUSDT(msg.sender, amount);
        return true;
    }

     function claimPIOtoPionChain(uint256 amount) external nonReentrant whenNotPaused returns (bool) {

        require(amount > 0, "Amount PIO must be > 0");
        UserInfo storage user = _userData[msg.sender];
        require(user.pioBalance >= amount, "Insufficient balance PIO");
        user.pioBalance -= amount;

        bytes32 requestId = IPioneChainBridge(PIONE_BRIDGE).bridgeOut(msg.sender, amount, 5090);

        emit ClaimedPIOtoPioneChain(requestId, msg.sender, amount);
        return true;
    }

    function getOptimalAmountPIO(uint256 pioAmount) external view returns (uint256 optimalUsdtAmount) {
        (uint256 reserveUsdt, uint256 reservePione) = getReserves();
        optimalUsdtAmount = router.quote(pioAmount, reservePione, reserveUsdt);
    }

    function getOptimalAmountUSDT(uint256 usdtAmount) external view returns (uint256 optimalPioAmount) {
        (uint256 reserveUsdt, uint256 reservePione) = getReserves();
        optimalPioAmount = router.quote(usdtAmount, reserveUsdt, reservePione);
    }

    function previewAddLiquidity(uint256 pioneAmount, uint256 usdtAmount)
        external
        view
        returns (
            uint256 actualPioAmount,
            uint256 actualUsdtAmount,
            uint256 estimatedLiquidity,
            uint256 refundPio,
            uint256 refundUsdt
        )
    {
        address pair = IUniswapV2Factory(router.factory()).getPair(PIONE_TOKEN, USDT_TOKEN);
        require(pair != address(0), "Pair does not exist");
        (uint256 reserveUsdt, uint256 reservePione) = getReserves();
        uint256 optimalUsdt = router.quote(pioneAmount, reservePione, reserveUsdt);

        if (optimalUsdt <= usdtAmount) {
            actualPioAmount = pioneAmount;
            actualUsdtAmount = optimalUsdt;
            refundUsdt = usdtAmount - optimalUsdt;
            refundPio = 0;
        } else {
            uint256 optimalPio = router.quote(usdtAmount, reserveUsdt, reservePione);
            actualPioAmount = optimalPio;
            actualUsdtAmount = usdtAmount;
            refundPio = pioneAmount - optimalPio;
            refundUsdt = 0;
        }

        // Estimate liquidity tokens
        uint256 totalSupply = IPancakePair(pair).totalSupply();
        estimatedLiquidity = (actualPioAmount * totalSupply) / reservePione;
    }

    function getReserves() public view returns(uint256 reserveUsdt, uint256 reservePione) {
        address pair = IUniswapV2Factory(router.factory()).getPair(PIONE_TOKEN, USDT_TOKEN);
        require(pair != address(0), "Pair does not exist");

        (uint256 reserve0, uint256 reserve1,) = IPancakePair(pair).getReserves();
        address token0 = IPancakePair(pair).token0();
        (reserveUsdt, reservePione) = token0 == USDT_TOKEN
            ? (reserve0, reserve1)
            : (reserve1, reserve0);
    }

    /**
     * @dev Helper function để lấy 6 ký tự cuối của địa chỉ
     */
    function _getLastSixChars(address addr) internal pure returns (string memory) {
        bytes memory addrBytes = abi.encodePacked(addr);
        bytes memory result = new bytes(6);

        for (uint i = 0; i < 6; i++) {
            result[i] = addrBytes[i + 14];
        }

        return _bytesToHexString(result);
    }

    /**
     * @dev Convert bytes to hex string
     */
    function _bytesToHexString(bytes memory data) internal pure returns (string memory) {
        bytes memory hexChars = "0123456789abcdef";
        bytes memory str = new bytes(data.length * 2);

        for (uint i = 0; i < data.length; i++) {
            str[i * 2] = hexChars[uint8(data[i] >> 4)];
            str[i * 2 + 1] = hexChars[uint8(data[i] & 0x0f)];
        }

        return string(str);
    }

    function getTransactionInfo(bytes32 requestId, address account)
        external
        view
        returns (
            uint256 pioAmount,
            uint256 usdtAmount,
            uint256 liquidityAmount,
            bool _depositUSDT,
            uint256 pinkLockId,
            uint256 userPioBalance,
            uint256 userUsdtBalance
        )
    {
        // Validate requestId exists
        require(_usedRequestIds[requestId], "RequestId does not exist");

        UserInfo storage user = _userData[account];
        uint256 position = user._positions[requestId];

        // Validate position bounds
        require(position < user.transactions.length, "Invalid position");

        Transaction storage txn = user.transactions[position];

        return (
            txn.pioAmount,
            txn.usdtAmount,
            txn.liquidityAmount,
            txn.depositUSDT,
            txn.pinkLockId,
            user.pioBalance,
            user.usdtBalance
        );
    }
    
    /**
     * @dev Pause contract - chỉ owner có thể gọi
     */
    function pause() external onlyOwner {
        _pause();
    }

    /**
     * @dev Unpause contract - chỉ owner có thể gọi
     */
    function unpause() external onlyOwner {
        _unpause();
    }

    function setLockTimePeriod(uint256 timePeriod) external onlyOwner {
        require(timePeriod > 0, "Time period must be greater than 0");
        _lockTimePeriod = timePeriod;
    }

    /**
     * @dev Get current lock time period
     * @return Current lock time period in seconds
     */
    function getLockTimePeriod() external view returns (uint256) {
        return _lockTimePeriod;
    }

    /**
     * @dev Emergency withdraw cho owner
     */
    function emergencyWithdraw(address token, address to) external onlyOwner {
        require(to != address(0), "Invalid recipient");
        uint256 balance = IERC20(token).balanceOf(address(this));
        require(balance > 0, "No balance");

        // Safe transfer for emergency withdrawal
        IERC20(token).safeTransfer(to, balance);

        emit EmergencyWithdraw(token, balance);
    }

    /**
     * @dev Set router address - for testing purposes only
     */
    function setRouter(address _router) external onlyOwner {
        require(_router != address(0), "Invalid router address");
        router = IPancakeRouter02(_router);
        IERC20(PIONE_TOKEN).approve(_router, type(uint256).max);
        IERC20(USDT_TOKEN).approve(_router, type(uint256).max);
    }

    /**
     * @dev Set PinkLock address - for testing purposes only
     */
    function setPinkLock(address _pinkLock) external onlyOwner {
        require(_pinkLock != address(0), "Invalid PinkLock address");
        PINK_LOCK = _pinkLock;
    }
}
