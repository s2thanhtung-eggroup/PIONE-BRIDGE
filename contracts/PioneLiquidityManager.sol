// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import { AccessControl } from "@openzeppelin/contracts/access/AccessControl.sol";
import { IBEP20 } from "./interfaces/IBEP20.sol";
import { IPancakeRouter02 } from "./interfaces/IPancakeRouter02.sol";
import { IPioneChainBridgeBSC } from "./interfaces/IPioneChainBridgeBSC.sol";

interface IUniswapV2Factory {
    function getPair(address tokenA, address tokenB) external view returns (address pair);
}

interface IPioneChainBridge {
    function bridgeCompleted(address user, uint256 amount) external;
}

contract PioneLiquidityManager is AccessControl {

    bytes32 public constant MANAGER_ROLE = keccak256("MANAGER_ROLE");
    address public immutable PIONE_TOKEN;
    address public immutable USDT_TOKEN;
    address public PIONE_BRIDGE;

    IPancakeRouter02 public router;

    struct Transaction {
        uint256 pioAmount;          
        uint256 usdtAmount;      
        uint256 liquidityAmount;
        bool depositUSDT;
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

    event UserDepositUSDT(bytes32 indexed requestId, address user, uint256 amount);
    event BridgeCompleted(bytes32 indexed requestId, address user, uint256 index);
    event LiquidityAdded(
        address indexed user, 
        bytes32 requestId,
        uint256 pioneAmount, 
        uint256 usdtAmount, 
        uint256 liquidity,
        uint256 slippage
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
        UserInfo storage user = _userData[msg.sender];
        uint256 position = user._positions[_requestId];

        require(user.transactions[position].usdtAmount == 0, "invalid requestId");
        require(user.transactions[position].liquidityAmount, "transaction executed");
        require(!user.transactions[position].depositUSDT, "Deposited USDT");
        _;
    }

    modifier canExecuted(bytes32 _requestId, address account) {
        UserInfo storage user = _userData[account];
        uint256 position = user._positions[_requestId];

        require(user.transactions[position].liquidityAmount == 0, "Request added liquidity");
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
        _lockTimePeriod = 30 days * 6;
        router = IPancakeRouter02(0x10ED43C718714eb63d5aA57B78B54704E256024E);
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(MANAGER_ROLE, msg.sender);
    }
    
    function handleBridgeCompleted(bytes32 requestId, address account, uint256 amountPIO, uint256 amountUSDT)
        external
        onlyManager
    {
        require(IPioneChainBridgeBSC(PIONE_BRIDGE).processedTransactions(requestId), "Transaction not completed");
        UserInfo storage userInfo = _userData[account];
        Transaction memory newTransaction = Transaction({
            pioAmount: amountPIO,
            usdtAmount: amountUSDT,
            liquidityAmount: 0,
            depositUSDT: false
        });
        uint256 index = userInfo.transactions.length;
        userInfo._positions[requestId] = index;
        userInfo.transactions.push(newTransaction);
        userInfo.pioBalance += amountPIO;

        emit BridgeCompleted(requestId, account, index);
    }
    
    function depositUSDT(bytes32 requestId) 
        external 
        canDeposit(requestId)
    {
        UserInfo storage user = _userData[msg.sender];
        uint256 position = user._positions[requestId];
        uint256 usdtAmount = user.transactions[position].usdtAmount;
        
        require(
            IBEP20(PIONE_TOKEN).transferFrom(msg.sender, address(this), usdtAmount),
            "Transfer failed"
        );
        user.transactions[position].executed = true;
        user.usdtBalance += usdtAmount;

        emit UserDepositUSDT(requestId, user, usdtAmount, user.usdtBalance);
    }
    
    function addLiquidity(
        bytes32 requestId,
        address account,
        uint256 slippagePercent
    ) external onlyManager canExecuted(requestId, account) {
        UserInfo storage user = _userData[msg.sender];
        uint256 position = user._positions[requestId];
        uint256 usdtAmount = user.transactions[position].usdtAmount;
        uint256 pioAmount = user.transactions[position].pioAmount;
        require(slippagePercent <= 50, "Slippage too high");
        require(userpioBalance[msg.sender] >= pioAmount, "Insufficient PIONE");
        require(userUsdtBalance[msg.sender] >= usdtAmount, "Insufficient USDT");
        
        uint256 amountPioneMin = pioAmount * (100 - slippagePercent) / 100;
        uint256 amountUsdtMin = usdtAmount * (100 - slippagePercent) / 100;
        
        userpioBalance[msg.sender] -= pioAmount;
        userUsdtBalance[msg.sender] -= usdtAmount;
        
        IBEP20(PIONE_TOKEN).approve(address(router), pioAmount);
        IBEP20(USDT_TOKEN).approve(address(router), usdtAmount);
        
        (uint amountA, uint amountB, uint liquidity) = router.addLiquidity(
            PIONE_TOKEN,
            USDT_TOKEN,
            pioAmount,
            usdtAmount,
            amountPioneMin,
            amountUsdtMin,
            LP_RECEIVER, 
            block.timestamp + 300 
        );
        
        // if (pioAmount > amountA) {
        //     userpioBalance[msg.sender] += (pioAmount - amountA);
        // }
        // if (usdtAmount > amountB) {
        //     userUsdtBalance[msg.sender] += (usdtAmount - amountB);
        // }
        
        emit LiquidityAdded(msg.sender, amountA, amountB, liquidity, slippagePercent);
    }
    
    /**
     * @dev Withdraw PIONE tokens
     */
    function withdrawPione(uint256 amount) external {
        require(amount > 0, "Amount must be > 0");
        require(userpioBalance[msg.sender] >= amount, "Insufficient balance");
        
        userpioBalance[msg.sender] -= amount;
        require(
            IBEP20(PIONE_TOKEN).transfer(msg.sender, amount),
            "Transfer failed"
        );
    }
    
    /**
     * @dev Withdraw USDT tokens về ví
     */
    function withdrawUsdt(uint256 amount) external {
        require(amount > 0, "Amount must be > 0");
        require(userUsdtBalance[msg.sender] >= amount, "Insufficient balance");
        
        userUsdtBalance[msg.sender] -= amount;
        require(
            IBEP20(USDT_TOKEN).transfer(msg.sender, amount),
            "Transfer failed"
        );
    }
    
    /**
     * @dev Tính toán optimal amounts cho liquidity dựa trên pool hiện tại
     */
    function getOptimalAmounts(uint256 pioneAmount) 
        external 
        view 
        returns (uint256 optimalUsdtAmount) 
    {
        address pair = IUniswapV2Factory(router.factory()).getPair(PIONE_TOKEN, USDT_TOKEN);
        require(pair != address(0), "Pair not exists");
        
        uint256 reservePione = IBEP20(PIONE_TOKEN).balanceOf(pair);
        uint256 reserveUsdt = IBEP20(USDT_TOKEN).balanceOf(pair);
        
        if (reservePione == 0 || reserveUsdt == 0) {
            return 0;
        }
        
        optimalUsdtAmount = (pioneAmount * reserveUsdt) / reservePione;
    }
    
    /**
     * @dev Emergency withdraw cho owner
     */
    function emergencyWithdraw(address token) external onlyOwner {
        uint256 balance = IBEP20(token).balanceOf(address(this));
        require(balance > 0, "No balance");
        
        require(
            IBEP20(token).transfer(owner, balance),
            "Transfer failed"
        );
        
        emit EmergencyWithdraw(token, balance);
    }
    
    /**
     * @dev Transfer ownership
     */
    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Invalid address");
        owner = newOwner;
    }
}
