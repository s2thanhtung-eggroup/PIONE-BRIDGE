// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;


/**
 * @title PIONE CHAIN Token (PIO)
 * 
 * @dev 
 *  - Built on OpenZeppelin Contracts v5.4.0
 *  - Includes cross-chain mint and burn mechanisms via an authorized bridge.
 *  - Enforces a hard-capped maximum total supply: 666 666 666 PIO.
 * 
 * @company  Pione Group
 * @team     Pione Labs
 * @contact  info@pionegroup.com
 * 
 * @author   Pione Labs
 */


import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Bridgeable} from "@openzeppelin/contracts/token/ERC20/extensions/draft-ERC20Bridgeable.sol";
import {ERC20Burnable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";


contract PIONECHAIN is
    ERC20,
    ERC20Bridgeable,
    ERC20Burnable,
    Ownable,
    ERC20Permit
{   
    
    // Maximum supply cap for the token
    uint public constant MAX_SUPPLY = 666_666_666 * 10**18;

    bool private _tokenBridgePaused; // Bridge pause state
    address public tokenBridge; // Authorized bridge contract address

    event TokenBridgeUpdated(address indexed oldTokenBridge, address indexed newTokenBridge);
    event TokenBridgePaused(address account);
    event TokenBridgeUnpaused(address account);
    
    error Unauthorized();

    constructor(
        address _initialOwner
    )
        ERC20("PIONE CHAIN", "PIO")
        Ownable(_initialOwner)
        ERC20Permit("PIONE CHAIN")
    {
        // Set to true by default during contract initialization to disable bridge operations
        _tokenBridgePaused = true;
    }

    /**
     * @dev Checks if the caller is trusted token bridge or owner.
     */
    function _checkTokenBridge(address caller) internal view override {
        if (caller != tokenBridge) revert Unauthorized();
    }

    /**
     * @dev Mint tokens through a crosschain transfer.
     */
    function crosschainMint(address _to, uint _value) public override onlyTokenBridge {
        require(!_tokenBridgePaused, "Token bridge is paused");
        require(totalSupply() + _value <= MAX_SUPPLY, "Minting would exceed max supply");
        super.crosschainMint(_to, _value);
    }

    /**
     * @dev Burn tokens through a crosschain transfer.
     */
    function crosschainBurn(address _from, uint _value) public override onlyTokenBridge {
        require(!_tokenBridgePaused, "Token bridge is paused");
        super.crosschainBurn(_from, _value);
    }

    /**
     * @notice Sets the token bridge contract address
     */
    function setTokenBridge(address tokenBridge_) external onlyOwner {
        require(tokenBridge_ != address(0), "Invalid tokenBridge_ address");
        require(tokenBridge != tokenBridge_, "Same tokenBridge address");
        emit TokenBridgeUpdated(tokenBridge, tokenBridge_);
        tokenBridge = tokenBridge_;
    }

    /**
     * @notice Pauses bridge operations
     */
    function pauseTokenBridge() external onlyOwner {
        require(!_tokenBridgePaused, "Token bridge already paused");
        _tokenBridgePaused = true;
        emit TokenBridgePaused(_msgSender());
    }

    /**
     * @notice Unpauses bridge operations
     */
    function unpauseTokenBridge() external onlyOwner {
        require(_tokenBridgePaused, "Token bridge not paused");
        _tokenBridgePaused = false;
        emit TokenBridgeUnpaused(_msgSender());
    }

    /**
     * @notice Returns bridge pause status
     */
    function tokenBridgePaused() external view returns (bool) { 
        return _tokenBridgePaused; 
    }
}
