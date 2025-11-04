// SPDX-License-Identifier: UNLICENSED
pragma solidity >=0.6.2;

interface IPancakeRouter02 {

    function factory() external pure returns (address);
    function addLiquidity(
        address tokenA,
        address tokenB,
        uint amountADesired,
        uint amountBDesired,
        uint amountAMin,
        uint amountBMin,
        address to,
        uint deadline
    ) external returns (uint amountA, uint amountB, uint liquidity);

    function quote(uint amountA, uint reserveA, uint reserveB) external pure returns (uint amountB);
}