// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Valueless test token (6 decimals like USDC) with a public faucet.
///         For Base Sepolia / local testing only.
contract MockUSDC is ERC20 {
    uint256 public constant FAUCET_AMOUNT = 1_000e6;

    constructor() ERC20("Fogline Test USD", "fUSD") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function faucet() external {
        _mint(msg.sender, FAUCET_AMOUNT);
    }
}
