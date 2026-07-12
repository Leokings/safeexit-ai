// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";

/// @notice Deterministic claim fixture. It is not a production airdrop implementation.
contract DemoAirdrop is Ownable {
    using SafeERC20 for IERC20;

    IERC20 public immutable rewardToken;
    mapping(address account => uint256 amount) public claimable;

    event ClaimConfigured(address indexed account, uint256 amount);
    event Claimed(address indexed account, uint256 amount);

    constructor(IERC20 rewardToken_, address initialOwner) Ownable(initialOwner) {
        require(address(rewardToken_) != address(0), "reward token is zero");
        rewardToken = rewardToken_;
    }

    function setClaimable(address account, uint256 amount) external onlyOwner {
        claimable[account] = amount;
        emit ClaimConfigured(account, amount);
    }

    function claim() external returns (uint256 amount) {
        amount = claimable[msg.sender];
        require(amount != 0, "nothing claimable");

        claimable[msg.sender] = 0;
        rewardToken.safeTransfer(msg.sender, amount);
        emit Claimed(msg.sender, amount);
    }
}
