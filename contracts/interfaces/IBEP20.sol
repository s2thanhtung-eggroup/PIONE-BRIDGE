// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @title IBEP20
 * @dev Extended BEP20 interface 
 */
interface IBEP20 {

    /**
     * @dev Emitted when tokens are transferred
     */
    event Transfer(address indexed from, address indexed to, uint256 value);

    /**
     * @dev Emitted when allowance is set
     */
    event Approval(address indexed owner, address indexed spender, uint256 value);

    // ============ Standard BEP20 Functions ============

    /**
     * @dev Returns the name of the token
     */
    function name() external view returns (string memory);

    /**
     * @dev Returns the symbol of the token
     */
    function symbol() external view returns (string memory);

    /**
     * @dev Returns the decimals of the token
     */
    function decimals() external view returns (uint8);

    /**
     * @dev Returns the total supply of tokens
     */
    function totalSupply() external view returns (uint256);

    /**
     * @dev Returns the balance of an account
     * @param account The address to query
     */
    function balanceOf(address account) external view returns (uint256);

    /**
     * @dev Transfers tokens to a recipient
     * @param recipient The address to transfer to
     * @param amount The amount to transfer
     * @return success True if the transfer succeeded
     */
    function transfer(address recipient, uint256 amount) external returns (bool);

    /**
     * @dev Returns the allowance of a spender for an owner
     * @param owner The address that owns the tokens
     * @param spender The address that can spend the tokens
     */
    function allowance(address owner, address spender) external view returns (uint256);

    /**
     * @dev Approves a spender to spend tokens
     * @param spender The address to approve
     * @param amount The amount to approve
     * @return success True if the approval succeeded
     */
    function approve(address spender, uint256 amount) external returns (bool);

    /**
     * @dev Transfers tokens from one address to another using allowance
     * @param sender The address to transfer from
     * @param recipient The address to transfer to
     * @param amount The amount to transfer
     * @return success True if the transfer succeeded
     */
    function transferFrom(
        address sender,
        address recipient,
        uint256 amount
    ) external returns (bool);

}
