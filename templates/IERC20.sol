// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/// Minimal, dependency-free ERC20 interface (incl. the common metadata getters) so suite code can
/// work with operator assets WITHOUT importing forge-std/OpenZeppelin:
///   IERC20(rvm.getAsset()).balanceOf(rvm.getActor());
///   IERC20(rvm.getAddr("lqty")).approve(spender, amount);
interface IERC20 {
    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    function name() external view returns (string memory);
    function symbol() external view returns (string memory);
    function decimals() external view returns (uint8);
    function totalSupply() external view returns (uint256);
    function balanceOf(address account) external view returns (uint256);
    function allowance(address owner, address spender) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function approve(address spender, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}
