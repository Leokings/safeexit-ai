import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { network } from "hardhat";
import { getAddress, keccak256, parseEther, parseSignature, stringToHex } from "viem";

const SETTLEMENT_NAME = "SafeExit Permit Settlement";
const ERC2612_NAME = "SafeExit ERC2612 TEST ONLY - NO VALUE";
const DAI_PERMIT_NAME = "SafeExit DAI Permit TEST ONLY - NO VALUE";
const ERC4494_NAME = "SafeExit ERC4494 TEST ONLY - NO VALUE";

const erc20RescueTypes = {
  ERC20Rescue: [
    { name: "token", type: "address" },
    { name: "owner", type: "address" },
    { name: "destination", type: "address" },
    { name: "amount", type: "uint256" },
    { name: "permitNonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
    { name: "rescueNonce", type: "bytes32" },
    { name: "permitKind", type: "uint8" },
  ],
} as const;

const erc721RescueTypes = {
  ERC721Rescue: [
    { name: "collection", type: "address" },
    { name: "owner", type: "address" },
    { name: "destination", type: "address" },
    { name: "tokenId", type: "uint256" },
    { name: "permitNonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
    { name: "rescueNonce", type: "bytes32" },
  ],
} as const;

function signatureTuple(signature: `0x${string}`) {
  const { v, r, s } = parseSignature(signature);
  return { v: Number(v), r, s };
}

describe("SafeExitPermitSettlement", async function () {
  const { viem } = await network.create();
  const publicClient = await viem.getPublicClient();
  const [, source, destination, outsider] = await viem.getWalletClients();
  const chainId = await publicClient.getChainId();

  async function latestTimestamp(): Promise<bigint> {
    return (await publicClient.getBlock()).timestamp;
  }

  it("atomically consumes an ERC-2612 permit and exact destination-bound rescue", async function () {
    const token = await viem.deployContract("SafeExitTestERC2612");
    const settlement = await viem.deployContract("SafeExitPermitSettlement");
    const amount = parseEther("125");
    const permitNonce = 0n;
    const deadline = (await latestTimestamp()) + 3_600n;
    const rescueNonce = keccak256(stringToHex("erc2612-rescue"));
    await token.write.faucet([source.account.address, amount]);

    const permitSignature = signatureTuple(await source.signTypedData({
      domain: {
        name: ERC2612_NAME,
        version: "1",
        chainId,
        verifyingContract: token.address,
      },
      types: {
        Permit: [
          { name: "owner", type: "address" },
          { name: "spender", type: "address" },
          { name: "value", type: "uint256" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" },
        ],
      },
      primaryType: "Permit",
      message: {
        owner: source.account.address,
        spender: settlement.address,
        value: amount,
        nonce: permitNonce,
        deadline,
      },
    }));
    const rescueSignature = signatureTuple(await source.signTypedData({
      domain: {
        name: SETTLEMENT_NAME,
        version: "1",
        chainId,
        verifyingContract: settlement.address,
      },
      types: erc20RescueTypes,
      primaryType: "ERC20Rescue",
      message: {
        token: token.address,
        owner: source.account.address,
        destination: destination.account.address,
        amount,
        permitNonce,
        deadline,
        rescueNonce,
        permitKind: 1,
      },
    }));
    const args = [
      token.address,
      source.account.address,
      destination.account.address,
      amount,
      permitNonce,
      deadline,
      rescueNonce,
      permitSignature,
      rescueSignature,
    ] as const;

    await assert.rejects(outsider.writeContract({
      address: settlement.address,
      abi: settlement.abi,
      functionName: "settleERC2612",
      args,
    }));

    await destination.writeContract({
      address: settlement.address,
      abi: settlement.abi,
      functionName: "settleERC2612",
      args,
    });

    assert.equal(await token.read.balanceOf([source.account.address]), 0n);
    assert.equal(await token.read.balanceOf([destination.account.address]), amount);
    assert.equal(await token.read.allowance([source.account.address, settlement.address]), 0n);
    assert.equal(await settlement.read.rescueNonceUsed([source.account.address, rescueNonce]), true);
    await assert.rejects(destination.writeContract({
      address: settlement.address,
      abi: settlement.abi,
      functionName: "settleERC2612",
      args,
    }));
  });

  it("rejects redirecting a valid permit and rescue signature", async function () {
    const token = await viem.deployContract("SafeExitTestERC2612");
    const settlement = await viem.deployContract("SafeExitPermitSettlement");
    const amount = parseEther("10");
    const deadline = (await latestTimestamp()) + 3_600n;
    const rescueNonce = keccak256(stringToHex("redirect-resistant-rescue"));
    await token.write.faucet([source.account.address, amount]);

    const permitSignature = signatureTuple(await source.signTypedData({
      domain: { name: ERC2612_NAME, version: "1", chainId, verifyingContract: token.address },
      types: {
        Permit: [
          { name: "owner", type: "address" },
          { name: "spender", type: "address" },
          { name: "value", type: "uint256" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" },
        ],
      },
      primaryType: "Permit",
      message: {
        owner: source.account.address,
        spender: settlement.address,
        value: amount,
        nonce: 0n,
        deadline,
      },
    }));
    const rescueSignature = signatureTuple(await source.signTypedData({
      domain: { name: SETTLEMENT_NAME, version: "1", chainId, verifyingContract: settlement.address },
      types: erc20RescueTypes,
      primaryType: "ERC20Rescue",
      message: {
        token: token.address,
        owner: source.account.address,
        destination: destination.account.address,
        amount,
        permitNonce: 0n,
        deadline,
        rescueNonce,
        permitKind: 1,
      },
    }));

    await assert.rejects(outsider.writeContract({
      address: settlement.address,
      abi: settlement.abi,
      functionName: "settleERC2612",
      args: [
        token.address,
        source.account.address,
        outsider.account.address,
        amount,
        0n,
        deadline,
        rescueNonce,
        permitSignature,
        rescueSignature,
      ],
    }));
    assert.equal(await token.read.balanceOf([source.account.address]), amount);
    assert.equal(await token.read.balanceOf([outsider.account.address]), 0n);
  });

  it("atomically grants, transfers, and revokes a DAI-style permit", async function () {
    const token = await viem.deployContract("SafeExitTestDaiPermit");
    const settlement = await viem.deployContract("SafeExitPermitSettlement");
    const amount = parseEther("75");
    const expiry = (await latestTimestamp()) + 3_600n;
    const rescueNonce = keccak256(stringToHex("dai-rescue"));
    await token.write.faucet([source.account.address, amount]);

    const permitTypes = {
      Permit: [
        { name: "holder", type: "address" },
        { name: "spender", type: "address" },
        { name: "nonce", type: "uint256" },
        { name: "expiry", type: "uint256" },
        { name: "allowed", type: "bool" },
      ],
    } as const;
    const signPermit = async (nonce: bigint, allowed: boolean) => signatureTuple(
      await source.signTypedData({
        domain: { name: DAI_PERMIT_NAME, version: "1", chainId, verifyingContract: token.address },
        types: permitTypes,
        primaryType: "Permit",
        message: {
          holder: source.account.address,
          spender: settlement.address,
          nonce,
          expiry,
          allowed,
        },
      }),
    );
    const rescueSignature = signatureTuple(await source.signTypedData({
      domain: { name: SETTLEMENT_NAME, version: "1", chainId, verifyingContract: settlement.address },
      types: erc20RescueTypes,
      primaryType: "ERC20Rescue",
      message: {
        token: token.address,
        owner: source.account.address,
        destination: destination.account.address,
        amount,
        permitNonce: 0n,
        deadline: expiry,
        rescueNonce,
        permitKind: 2,
      },
    }));

    await destination.writeContract({
      address: settlement.address,
      abi: settlement.abi,
      functionName: "settleDaiPermit",
      args: [
        token.address,
        source.account.address,
        destination.account.address,
        amount,
        0n,
        expiry,
        rescueNonce,
        await signPermit(0n, true),
        await signPermit(1n, false),
        rescueSignature,
      ],
    });

    assert.equal(await token.read.balanceOf([destination.account.address]), amount);
    assert.equal(await token.read.allowance([source.account.address, settlement.address]), 0n);
    assert.equal(await token.read.nonces([source.account.address]), 2n);
  });

  it("atomically consumes an ERC-4494 permit and transfers the committed NFT", async function () {
    const nft = await viem.deployContract("SafeExitTestERC4494");
    const settlement = await viem.deployContract("SafeExitPermitSettlement");
    const tokenId = 1n;
    const permitNonce = 0n;
    const deadline = (await latestTimestamp()) + 3_600n;
    const rescueNonce = keccak256(stringToHex("erc4494-rescue"));
    await nft.write.faucet([source.account.address]);

    const permitSignature = await source.signTypedData({
      domain: { name: ERC4494_NAME, version: "1", chainId, verifyingContract: nft.address },
      types: {
        Permit: [
          { name: "spender", type: "address" },
          { name: "tokenId", type: "uint256" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" },
        ],
      },
      primaryType: "Permit",
      message: { spender: settlement.address, tokenId, nonce: permitNonce, deadline },
    });
    const rescueSignature = signatureTuple(await source.signTypedData({
      domain: { name: SETTLEMENT_NAME, version: "1", chainId, verifyingContract: settlement.address },
      types: erc721RescueTypes,
      primaryType: "ERC721Rescue",
      message: {
        collection: nft.address,
        owner: source.account.address,
        destination: destination.account.address,
        tokenId,
        permitNonce,
        deadline,
        rescueNonce,
      },
    }));

    await destination.writeContract({
      address: settlement.address,
      abi: settlement.abi,
      functionName: "settleERC4494",
      args: [
        nft.address,
        source.account.address,
        destination.account.address,
        tokenId,
        permitNonce,
        deadline,
        rescueNonce,
        permitSignature,
        rescueSignature,
      ],
    });

    assert.equal(await nft.read.ownerOf([tokenId]), getAddress(destination.account.address));
    assert.equal(await nft.read.nonces([tokenId]), 1n);
  });
});
