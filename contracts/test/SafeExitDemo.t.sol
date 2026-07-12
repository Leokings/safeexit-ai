// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { RescueToken } from "../src/RescueToken.sol";
import { DemoNFT } from "../src/DemoNFT.sol";
import { DemoAirdrop } from "../src/DemoAirdrop.sol";
import { DemoAttackerSimulation } from "../src/DemoAttackerSimulation.sol";

interface Vm {
    function chainId(uint256 newChainId) external;
    function prank(address sender) external;
    function startPrank(address sender) external;
    function stopPrank() external;
    function expectRevert() external;
}

contract SafeExitDemoTest {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    address private constant COMPROMISED = 0x70997970C51812dc3A010C7d01b50e0d17dc79C8;
    address private constant DESTINATION = 0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65;
    address private constant ATTACKER_SINK = 0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC;

    uint256 private constant INITIAL_TOKENS = 100 ether;
    uint256 private constant CLAIM_REWARD = 50 ether;
    uint256 private constant SWEEP_AMOUNT = 25 ether;

    RescueToken private token;
    DemoNFT private nft;
    DemoAirdrop private airdrop;
    DemoAttackerSimulation private attacker;

    function setUp() public {
        vm.chainId(31_337);
        token = new RescueToken(address(this));
        nft = new DemoNFT(address(this));
        airdrop = new DemoAirdrop(token, address(this));
        attacker = new DemoAttackerSimulation(token, SWEEP_AMOUNT);

        token.mint(COMPROMISED, INITIAL_TOKENS);
        token.mint(address(airdrop), CLAIM_REWARD);
        nft.mint(COMPROMISED);
        airdrop.setClaimable(COMPROMISED, CLAIM_REWARD);

        vm.prank(COMPROMISED);
        token.approve(address(attacker), SWEEP_AMOUNT);
    }

    function testDetectsClaimAndCompletesRescue() public {
        require(airdrop.claimable(COMPROMISED) == CLAIM_REWARD, "claim not detected");

        vm.startPrank(COMPROMISED);
        airdrop.claim();
        require(token.balanceOf(COMPROMISED) == INITIAL_TOKENS + CLAIM_REWARD, "claim failed");

        token.transfer(DESTINATION, INITIAL_TOKENS + CLAIM_REWARD);
        nft.safeTransferFrom(COMPROMISED, DESTINATION, 1);
        token.approve(address(attacker), 0);
        vm.stopPrank();

        require(token.balanceOf(DESTINATION) == INITIAL_TOKENS + CLAIM_REWARD, "token not rescued");
        require(nft.ownerOf(1) == DESTINATION, "NFT not rescued");
        require(token.allowance(COMPROMISED, address(attacker)) == 0, "approval not revoked");
        require(airdrop.claimable(COMPROMISED) == 0, "claim not consumed");

        vm.expectRevert();
        attacker.attemptDemoSweep();
    }

    function testAttackerFixtureOnlyExercisesFixedDemoTarget() public {
        require(attacker.DEMO_TARGET() == COMPROMISED, "unexpected target");
        require(attacker.DEMO_SINK() == ATTACKER_SINK, "unexpected sink");

        attacker.attemptDemoSweep();

        require(token.balanceOf(COMPROMISED) == INITIAL_TOKENS - SWEEP_AMOUNT, "target unchanged");
        require(token.balanceOf(ATTACKER_SINK) == SWEEP_AMOUNT, "sink unchanged");
    }
}
