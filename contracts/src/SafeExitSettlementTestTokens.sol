// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";

contract SafeExitTestFeeOnTransferERC2612 is ERC20, ERC20Permit {
    constructor()
        ERC20("SafeExit Fee Token TEST ONLY - NO VALUE", "SXFEE")
        ERC20Permit("SafeExit Fee Token TEST ONLY - NO VALUE")
    {}

    function faucet(address recipient, uint256 amount) external {
        _mint(recipient, amount);
    }

    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0) && to != address(0) && value >= 100) {
            uint256 fee = value / 100;
            super._update(from, to, value - fee);
            super._update(from, address(0), fee);
            return;
        }
        super._update(from, to, value);
    }
}
