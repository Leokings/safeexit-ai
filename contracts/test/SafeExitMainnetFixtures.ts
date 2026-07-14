import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { network } from "hardhat";
import { getAddress, keccak256, parseEther, parseSignature, stringToHex } from "viem";

const ERC2612_NAME = "SafeExit ERC2612 TEST ONLY - NO VALUE";
const ERC3009_NAME = "SafeExit ERC3009 TEST ONLY - NO VALUE";
const DAI_PERMIT_NAME = "SafeExit DAI Permit TEST ONLY - NO VALUE";
const ERC4494_NAME = "SafeExit ERC4494 TEST ONLY - NO VALUE";

describe("SafeExit mainnet fixtures", async function () {
  const { viem } = await network.create();
  const publicClient = await viem.getPublicClient();
  const [, source, destination, outsider] = await viem.getWalletClients();
  const chainId = await publicClient.getChainId();

  async function latestTimestamp(): Promise<bigint> {
    return (await publicClient.getBlock()).timestamp;
  }

  it("executes an ERC-2612 destination-paid rescue", async function () {
    const token = await viem.deployContract("SafeExitTestERC2612");
    const amount = parseEther("125");

    await token.write.faucet([source.account.address, amount]);

    const nonce = await token.read.nonces([source.account.address]);
    const deadline = (await latestTimestamp()) + 3_600n;
    const signature = await source.signTypedData({
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
        spender: destination.account.address,
        value: amount,
        nonce,
        deadline,
      },
    });
    const { r, s, v } = parseSignature(signature);

    await destination.writeContract({
      address: token.address,
      abi: token.abi,
      functionName: "permit",
      args: [
        source.account.address,
        destination.account.address,
        amount,
        deadline,
        Number(v),
        r,
        s,
      ],
    });
    await destination.writeContract({
      address: token.address,
      abi: token.abi,
      functionName: "transferFrom",
      args: [source.account.address, destination.account.address, amount],
    });

    assert.equal(await token.read.balanceOf([source.account.address]), 0n);
    assert.equal(await token.read.balanceOf([destination.account.address]), amount);
    assert.equal(await token.read.nonces([source.account.address]), nonce + 1n);
    assert.deepEqual(await token.read.eip712Domain(), [
      "0x0f",
      ERC2612_NAME,
      "1",
      BigInt(chainId),
      getAddress(token.address),
      `0x${"0".repeat(64)}`,
      [],
    ]);
  });

  it("executes ERC-3009 receiveWithAuthorization and rejects replay", async function () {
    const token = await viem.deployContract("SafeExitTestERC3009");
    const amount = parseEther("250");
    await token.write.faucet([source.account.address, amount]);

    const now = await latestTimestamp();
    const validAfter = now - 1n;
    const validBefore = now + 3_600n;
    const nonce = keccak256(stringToHex("safeexit-erc3009-test-authorization"));
    const signature = await source.signTypedData({
      domain: {
        name: ERC3009_NAME,
        version: "1",
        chainId,
        verifyingContract: token.address,
      },
      types: {
        ReceiveWithAuthorization: [
          { name: "from", type: "address" },
          { name: "to", type: "address" },
          { name: "value", type: "uint256" },
          { name: "validAfter", type: "uint256" },
          { name: "validBefore", type: "uint256" },
          { name: "nonce", type: "bytes32" },
        ],
      },
      primaryType: "ReceiveWithAuthorization",
      message: {
        from: source.account.address,
        to: destination.account.address,
        value: amount,
        validAfter,
        validBefore,
        nonce,
      },
    });
    const { r, s, v } = parseSignature(signature);
    const args = [
      source.account.address,
      destination.account.address,
      amount,
      validAfter,
      validBefore,
      nonce,
      Number(v),
      r,
      s,
    ] as const;

    await assert.rejects(
      outsider.writeContract({
        address: token.address,
        abi: token.abi,
        functionName: "receiveWithAuthorization",
        args,
      }),
    );

    await destination.writeContract({
      address: token.address,
      abi: token.abi,
      functionName: "receiveWithAuthorization",
      args,
    });

    assert.equal(await token.read.authorizationState([source.account.address, nonce]), true);
    assert.equal(await token.read.balanceOf([destination.account.address]), amount);
    await assert.rejects(
      destination.writeContract({
        address: token.address,
        abi: token.abi,
        functionName: "receiveWithAuthorization",
        args,
      }),
    );
  });

  it("executes and revokes a DAI-style permit", async function () {
    const token = await viem.deployContract("SafeExitTestDaiPermit");
    const amount = parseEther("75");
    await token.write.faucet([source.account.address, amount]);

    const expiry = (await latestTimestamp()) + 3_600n;
    const permitTypes = {
      Permit: [
        { name: "holder", type: "address" },
        { name: "spender", type: "address" },
        { name: "nonce", type: "uint256" },
        { name: "expiry", type: "uint256" },
        { name: "allowed", type: "bool" },
      ],
    } as const;
    const signPermit = async (nonce: bigint, allowed: boolean) =>
      parseSignature(
        await source.signTypedData({
          domain: {
            name: DAI_PERMIT_NAME,
            version: "1",
            chainId,
            verifyingContract: token.address,
          },
          types: permitTypes,
          primaryType: "Permit",
          message: {
            holder: source.account.address,
            spender: destination.account.address,
            nonce,
            expiry,
            allowed,
          },
        }),
      );

    const allowSignature = await signPermit(0n, true);
    await destination.writeContract({
      address: token.address,
      abi: token.abi,
      functionName: "permit",
      args: [
        source.account.address,
        destination.account.address,
        0n,
        expiry,
        true,
        Number(allowSignature.v),
        allowSignature.r,
        allowSignature.s,
      ],
    });
    await destination.writeContract({
      address: token.address,
      abi: token.abi,
      functionName: "transferFrom",
      args: [source.account.address, destination.account.address, amount],
    });

    const revokeSignature = await signPermit(1n, false);
    await destination.writeContract({
      address: token.address,
      abi: token.abi,
      functionName: "permit",
      args: [
        source.account.address,
        destination.account.address,
        1n,
        expiry,
        false,
        Number(revokeSignature.v),
        revokeSignature.r,
        revokeSignature.s,
      ],
    });

    assert.equal(await token.read.balanceOf([destination.account.address]), amount);
    assert.equal(await token.read.allowance([source.account.address, destination.account.address]), 0n);
    assert.equal(await token.read.nonces([source.account.address]), 2n);
  });

  it("executes an ERC-4494 permit and invalidates it on transfer", async function () {
    const nft = await viem.deployContract("SafeExitTestERC4494");
    const tokenId = 1n;
    await nft.write.faucet([source.account.address]);

    assert.equal(await nft.read.supportsInterface(["0x5604e225"]), true);
    const nonce = await nft.read.nonces([tokenId]);
    const deadline = (await latestTimestamp()) + 3_600n;
    const signature = await source.signTypedData({
      domain: {
        name: ERC4494_NAME,
        version: "1",
        chainId,
        verifyingContract: nft.address,
      },
      types: {
        Permit: [
          { name: "spender", type: "address" },
          { name: "tokenId", type: "uint256" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" },
        ],
      },
      primaryType: "Permit",
      message: {
        spender: destination.account.address,
        tokenId,
        nonce,
        deadline,
      },
    });

    await destination.writeContract({
      address: nft.address,
      abi: nft.abi,
      functionName: "permit",
      args: [destination.account.address, tokenId, deadline, signature],
    });
    assert.equal(await nft.read.getApproved([tokenId]), getAddress(destination.account.address));

    await destination.writeContract({
      address: nft.address,
      abi: nft.abi,
      functionName: "transferFrom",
      args: [source.account.address, destination.account.address, tokenId],
    });

    assert.equal(await nft.read.ownerOf([tokenId]), getAddress(destination.account.address));
    assert.equal(await nft.read.nonces([tokenId]), nonce + 1n);
    await assert.rejects(
      outsider.writeContract({
        address: nft.address,
        abi: nft.abi,
        functionName: "permit",
        args: [destination.account.address, tokenId, deadline, signature],
      }),
    );
  });
});
