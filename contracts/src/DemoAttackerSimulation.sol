// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @notice DEMO ATTACKER SIMULATION - LOCAL ANVIL ONLY.
/// @dev This fixture has no configurable victim or recipient. It can only exercise an allowance
/// granted by the known Anvil development account against a developer-created local token.
contract DemoAttackerSimulation {
    using SafeERC20 for IERC20;

    uint256 public constant DEMO_CHAIN_ID = 31_337;
    address public constant DEMO_TARGET = 0x70997970C51812dc3A010C7d01b50e0d17dc79C8;
    address public constant DEMO_SINK = 0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC;

    IERC20 public immutable demoToken;
    uint256 public immutable fixedSweepAmount;

    constructor(IERC20 demoToken_, uint256 fixedSweepAmount_) {
        require(block.chainid == DEMO_CHAIN_ID, "local Anvil only");
        require(address(demoToken_).code.length != 0, "demo token required");
        require(fixedSweepAmount_ != 0, "sweep amount is zero");

        demoToken = demoToken_;
        fixedSweepAmount = fixedSweepAmount_;
    }

    function attemptDemoSweep() external {
        demoToken.safeTransferFrom(DEMO_TARGET, DEMO_SINK, fixedSweepAmount);
    }
}
