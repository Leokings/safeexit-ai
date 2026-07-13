// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { RescueToken } from "../src/RescueToken.sol";
import { DaiStyleRescueToken } from "../src/DaiStyleRescueToken.sol";
import { DemoNFT } from "../src/DemoNFT.sol";
import { DemoAirdrop } from "../src/DemoAirdrop.sol";
import { DemoAttackerSimulation } from "../src/DemoAttackerSimulation.sol";

interface Vm {
    function addr(uint256 privateKey) external returns (address);
    function chainId(uint256 newChainId) external;
    function prank(address sender) external;
    function startPrank(address sender) external;
    function stopPrank() external;
    function expectRevert() external;
    function sign(uint256 privateKey, bytes32 digest)
        external
        returns (uint8 v, bytes32 r, bytes32 s);
}

contract SafeExitDemoTest {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    address private constant COMPROMISED = 0x70997970C51812dc3A010C7d01b50e0d17dc79C8;
    address private constant DESTINATION = 0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65;
    address private constant ATTACKER_SINK = 0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC;

    uint256 private constant INITIAL_TOKENS = 100 ether;
    uint256 private constant CLAIM_REWARD = 50 ether;
    uint256 private constant SWEEP_AMOUNT = 25 ether;
    bytes32 private constant PERMIT_TYPEHASH = keccak256(
        "Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"
    );
    bytes32 private constant NFT_PERMIT_TYPEHASH = keccak256(
        "Permit(address spender,uint256 tokenId,uint256 nonce,uint256 deadline)"
    );
    bytes32 private constant DAI_PERMIT_TYPEHASH = keccak256(
        "Permit(address holder,address spender,uint256 nonce,uint256 expiry,bool allowed)"
    );

    RescueToken private token;
    DaiStyleRescueToken private daiStyleToken;
    DemoNFT private nft;
    DemoAirdrop private airdrop;
    DemoAttackerSimulation private attacker;

    function setUp() public {
        vm.chainId(31_337);
        token = new RescueToken(address(this));
        daiStyleToken = new DaiStyleRescueToken(address(this));
        nft = new DemoNFT(address(this));
        airdrop = new DemoAirdrop(token, address(this));
        attacker = new DemoAttackerSimulation(token, SWEEP_AMOUNT);

        token.mint(COMPROMISED, INITIAL_TOKENS);
        daiStyleToken.mint(COMPROMISED, INITIAL_TOKENS);
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

    function testDestinationPaysForPermitRescue() public {
        uint256 compromisedPrivateKey =
            0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d;
        require(vm.addr(compromisedPrivateKey) == COMPROMISED, "unexpected permit signer");

        uint256 amount = 40 ether;
        uint256 deadline = block.timestamp + 5 minutes;
        bytes32 structHash = keccak256(
            abi.encode(
                PERMIT_TYPEHASH,
                COMPROMISED,
                DESTINATION,
                amount,
                token.nonces(COMPROMISED),
                deadline
            )
        );
        bytes32 digest = keccak256(
            abi.encodePacked("\x19\x01", token.DOMAIN_SEPARATOR(), structHash)
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(compromisedPrivateKey, digest);

        vm.startPrank(DESTINATION);
        token.permit(COMPROMISED, DESTINATION, amount, deadline, v, r, s);
        token.transferFrom(COMPROMISED, DESTINATION, amount);
        vm.stopPrank();

        require(token.balanceOf(DESTINATION) == amount, "permit rescue failed");
        require(token.nonces(COMPROMISED) == 1, "permit nonce not consumed");
    }

    function testDestinationPaysForNftPermitRescue() public {
        uint256 compromisedPrivateKey =
            0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d;
        uint256 deadline = block.timestamp + 5 minutes;
        bytes32 structHash = keccak256(
            abi.encode(NFT_PERMIT_TYPEHASH, DESTINATION, 1, nft.nonces(1), deadline)
        );
        bytes32 digest = keccak256(
            abi.encodePacked("\x19\x01", nft.DOMAIN_SEPARATOR(), structHash)
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(compromisedPrivateKey, digest);
        bytes memory signature = abi.encodePacked(r, s, v);

        vm.startPrank(DESTINATION);
        nft.permit(DESTINATION, 1, deadline, signature);
        nft.transferFrom(COMPROMISED, DESTINATION, 1);
        vm.stopPrank();

        require(nft.ownerOf(1) == DESTINATION, "NFT permit rescue failed");
        require(nft.nonces(1) == 1, "NFT transfer nonce not consumed");

        vm.prank(DESTINATION);
        vm.expectRevert();
        nft.permit(DESTINATION, 1, deadline, signature);
    }

    function testDestinationPaysAndRevokesDaiStylePermit() public {
        uint256 compromisedPrivateKey =
            0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d;
        uint256 amount = 40 ether;
        uint256 expiry = block.timestamp + 5 minutes;

        bytes32 allowHash = keccak256(
            abi.encode(
                DAI_PERMIT_TYPEHASH,
                COMPROMISED,
                DESTINATION,
                0,
                expiry,
                true
            )
        );
        bytes32 allowDigest = keccak256(
            abi.encodePacked("\x19\x01", daiStyleToken.DOMAIN_SEPARATOR(), allowHash)
        );
        (uint8 allowV, bytes32 allowR, bytes32 allowS) =
            vm.sign(compromisedPrivateKey, allowDigest);

        bytes32 revokeHash = keccak256(
            abi.encode(
                DAI_PERMIT_TYPEHASH,
                COMPROMISED,
                DESTINATION,
                1,
                expiry,
                false
            )
        );
        bytes32 revokeDigest = keccak256(
            abi.encodePacked("\x19\x01", daiStyleToken.DOMAIN_SEPARATOR(), revokeHash)
        );
        (uint8 revokeV, bytes32 revokeR, bytes32 revokeS) =
            vm.sign(compromisedPrivateKey, revokeDigest);

        vm.startPrank(DESTINATION);
        daiStyleToken.permit(
            COMPROMISED,
            DESTINATION,
            0,
            expiry,
            true,
            allowV,
            allowR,
            allowS
        );
        daiStyleToken.transferFrom(COMPROMISED, DESTINATION, amount);
        daiStyleToken.permit(
            COMPROMISED,
            DESTINATION,
            1,
            expiry,
            false,
            revokeV,
            revokeR,
            revokeS
        );
        vm.stopPrank();

        require(daiStyleToken.balanceOf(DESTINATION) == amount, "DAI-style rescue failed");
        require(daiStyleToken.nonces(COMPROMISED) == 2, "DAI-style nonces not consumed");
        require(
            daiStyleToken.allowance(COMPROMISED, DESTINATION) == 0,
            "DAI-style allowance not revoked"
        );
    }
}
