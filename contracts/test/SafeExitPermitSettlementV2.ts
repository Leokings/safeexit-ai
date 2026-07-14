import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { network } from "hardhat";
import {
  getAddress,
  keccak256,
  parseEther,
  parseSignature,
  stringToHex,
  type Address,
} from "viem";

const SETTLEMENT_NAME = "SafeExit Permit Settlement";
const SETTLEMENT_VERSION = "2";
const ERC2612_NAME = "SafeExit ERC2612 TEST ONLY - NO VALUE";
const FEE_TOKEN_NAME = "SafeExit Fee Token TEST ONLY - NO VALUE";
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

const permitTypes = {
  Permit: [
    { name: "owner", type: "address" },
    { name: "spender", type: "address" },
    { name: "value", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

const daiPermitTypes = {
  Permit: [
    { name: "holder", type: "address" },
    { name: "spender", type: "address" },
    { name: "nonce", type: "uint256" },
    { name: "expiry", type: "uint256" },
    { name: "allowed", type: "bool" },
  ],
} as const;

function signatureTuple(signature: `0x${string}`) {
  const { v, r, s } = parseSignature(signature);
  return { v: Number(v), r, s };
}

describe("SafeExitPermitSettlementV2", async function () {
  const { viem } = await network.create();
  const publicClient = await viem.getPublicClient();
  const [, source, destination, outsider] = await viem.getWalletClients();
  const chainId = await publicClient.getChainId();

  async function latestTimestamp(): Promise<bigint> {
    return (await publicClient.getBlock()).timestamp;
  }

  async function signErc2612(
    token: Address,
    settlement: Address,
    amount: bigint,
    permitNonce: bigint,
    deadline: bigint,
    rescueNonce: `0x${string}`,
    tokenName = ERC2612_NAME,
  ) {
    const permitSignature = signatureTuple(await source.signTypedData({
      domain: { name: tokenName, version: "1", chainId, verifyingContract: token },
      types: permitTypes,
      primaryType: "Permit",
      message: {
        owner: source.account.address,
        spender: settlement,
        value: amount,
        nonce: permitNonce,
        deadline,
      },
    }));
    const rescueSignature = signatureTuple(await source.signTypedData({
      domain: {
        name: SETTLEMENT_NAME,
        version: SETTLEMENT_VERSION,
        chainId,
        verifyingContract: settlement,
      },
      types: erc20RescueTypes,
      primaryType: "ERC20Rescue",
      message: {
        token,
        owner: source.account.address,
        destination: destination.account.address,
        amount,
        permitNonce,
        deadline,
        rescueNonce,
        permitKind: 1,
      },
    }));
    return { permitSignature, rescueSignature };
  }

  async function signDaiPermit(
    token: Address,
    settlement: Address,
    nonce: bigint,
    expiry: bigint,
    allowed: boolean,
    signer = source,
  ) {
    return signatureTuple(await signer.signTypedData({
      domain: { name: DAI_PERMIT_NAME, version: "1", chainId, verifyingContract: token },
      types: daiPermitTypes,
      primaryType: "Permit",
      message: {
        holder: source.account.address,
        spender: settlement,
        nonce,
        expiry,
        allowed,
      },
    }));
  }

  async function signDaiRescue(
    token: Address,
    settlement: Address,
    amount: bigint,
    nonce: bigint,
    expiry: bigint,
    rescueNonce: `0x${string}`,
  ) {
    return signatureTuple(await source.signTypedData({
      domain: {
        name: SETTLEMENT_NAME,
        version: SETTLEMENT_VERSION,
        chainId,
        verifyingContract: settlement,
      },
      types: erc20RescueTypes,
      primaryType: "ERC20Rescue",
      message: {
        token,
        owner: source.account.address,
        destination: destination.account.address,
        amount,
        permitNonce: nonce,
        deadline: expiry,
        rescueNonce,
        permitKind: 2,
      },
    }));
  }

  it("settles an ERC-2612 rescue and consumes its authorization once", async function () {
    const token = await viem.deployContract("SafeExitTestERC2612");
    const settlement = await viem.deployContract("SafeExitPermitSettlementV2");
    const amount = parseEther("125");
    const deadline = (await latestTimestamp()) + 3_600n;
    const rescueNonce = keccak256(stringToHex("v2-erc2612"));
    await token.write.faucet([source.account.address, amount]);
    const signatures = await signErc2612(
      token.address,
      settlement.address,
      amount,
      0n,
      deadline,
      rescueNonce,
    );
    const args = [
      token.address,
      source.account.address,
      destination.account.address,
      amount,
      0n,
      deadline,
      rescueNonce,
      signatures.permitSignature,
      signatures.rescueSignature,
    ] as const;

    await destination.writeContract({
      address: settlement.address,
      abi: settlement.abi,
      functionName: "settleERC2612",
      args,
    });

    assert.equal(await token.read.balanceOf([source.account.address]), 0n);
    assert.equal(await token.read.balanceOf([destination.account.address]), amount);
    assert.equal(await token.read.allowance([source.account.address, settlement.address]), 0n);
    await assert.rejects(destination.writeContract({
      address: settlement.address,
      abi: settlement.abi,
      functionName: "settleERC2612",
      args,
    }));
  });

  it("settles after an ERC-2612 permit is pre-consumed", async function () {
    const token = await viem.deployContract("SafeExitTestERC2612");
    const settlement = await viem.deployContract("SafeExitPermitSettlementV2");
    const amount = parseEther("40");
    const deadline = (await latestTimestamp()) + 3_600n;
    const rescueNonce = keccak256(stringToHex("v2-preconsumed-erc2612"));
    await token.write.faucet([source.account.address, amount]);
    const signatures = await signErc2612(
      token.address,
      settlement.address,
      amount,
      0n,
      deadline,
      rescueNonce,
    );

    await outsider.writeContract({
      address: token.address,
      abi: token.abi,
      functionName: "permit",
      args: [
        source.account.address,
        settlement.address,
        amount,
        deadline,
        signatures.permitSignature.v,
        signatures.permitSignature.r,
        signatures.permitSignature.s,
      ],
    });
    assert.equal(await token.read.nonces([source.account.address]), 1n);

    await destination.writeContract({
      address: settlement.address,
      abi: settlement.abi,
      functionName: "settleERC2612",
      args: [
        token.address,
        source.account.address,
        destination.account.address,
        amount,
        0n,
        deadline,
        rescueNonce,
        signatures.permitSignature,
        signatures.rescueSignature,
      ],
    });
    assert.equal(await token.read.balanceOf([destination.account.address]), amount);
    assert.equal(await token.read.allowance([source.account.address, settlement.address]), 0n);
  });

  it("rejects a stale ERC-2612 nonce without the exact settlement allowance", async function () {
    const token = await viem.deployContract("SafeExitTestERC2612");
    const settlement = await viem.deployContract("SafeExitPermitSettlementV2");
    const amount = parseEther("30");
    const deadline = (await latestTimestamp()) + 3_600n;
    const rescueNonce = keccak256(stringToHex("v2-stale-erc2612"));
    await token.write.faucet([source.account.address, amount]);
    const signatures = await signErc2612(
      token.address,
      settlement.address,
      amount,
      0n,
      deadline,
      rescueNonce,
    );
    const unrelatedPermit = signatureTuple(await source.signTypedData({
      domain: { name: ERC2612_NAME, version: "1", chainId, verifyingContract: token.address },
      types: permitTypes,
      primaryType: "Permit",
      message: {
        owner: source.account.address,
        spender: outsider.account.address,
        value: 1n,
        nonce: 0n,
        deadline,
      },
    }));
    await outsider.writeContract({
      address: token.address,
      abi: token.abi,
      functionName: "permit",
      args: [
        source.account.address,
        outsider.account.address,
        1n,
        deadline,
        unrelatedPermit.v,
        unrelatedPermit.r,
        unrelatedPermit.s,
      ],
    });

    await assert.rejects(destination.writeContract({
      address: settlement.address,
      abi: settlement.abi,
      functionName: "settleERC2612",
      args: [
        token.address,
        source.account.address,
        destination.account.address,
        amount,
        0n,
        deadline,
        rescueNonce,
        signatures.permitSignature,
        signatures.rescueSignature,
      ],
    }));
    assert.equal(await token.read.balanceOf([source.account.address]), amount);
    assert.equal(await settlement.read.rescueNonceUsed([source.account.address, rescueNonce]), false);
  });

  it("rejects expired and amount-substituted rescue authorizations", async function () {
    const token = await viem.deployContract("SafeExitTestERC2612");
    const settlement = await viem.deployContract("SafeExitPermitSettlementV2");
    const amount = parseEther("20");
    await token.write.faucet([source.account.address, amount + 1n]);

    const expiredDeadline = (await latestTimestamp()) - 1n;
    const expiredNonce = keccak256(stringToHex("v2-expired"));
    const expired = await signErc2612(
      token.address,
      settlement.address,
      amount,
      0n,
      expiredDeadline,
      expiredNonce,
    );
    await assert.rejects(destination.writeContract({
      address: settlement.address,
      abi: settlement.abi,
      functionName: "settleERC2612",
      args: [
        token.address,
        source.account.address,
        destination.account.address,
        amount,
        0n,
        expiredDeadline,
        expiredNonce,
        expired.permitSignature,
        expired.rescueSignature,
      ],
    }));

    const deadline = (await latestTimestamp()) + 3_600n;
    const substitutedNonce = keccak256(stringToHex("v2-substituted-amount"));
    const signed = await signErc2612(
      token.address,
      settlement.address,
      amount,
      0n,
      deadline,
      substitutedNonce,
    );
    await assert.rejects(destination.writeContract({
      address: settlement.address,
      abi: settlement.abi,
      functionName: "settleERC2612",
      args: [
        token.address,
        source.account.address,
        destination.account.address,
        amount + 1n,
        0n,
        deadline,
        substitutedNonce,
        signed.permitSignature,
        signed.rescueSignature,
      ],
    }));
    assert.equal(await token.read.balanceOf([destination.account.address]), 0n);
    assert.equal(await settlement.read.rescueNonceUsed([source.account.address, expiredNonce]), false);
    assert.equal(await settlement.read.rescueNonceUsed([source.account.address, substitutedNonce]), false);
  });

  it("rejects fee-on-transfer tokens and rolls back permit state", async function () {
    const token = await viem.deployContract("SafeExitTestFeeOnTransferERC2612");
    const settlement = await viem.deployContract("SafeExitPermitSettlementV2");
    const amount = parseEther("100");
    const deadline = (await latestTimestamp()) + 3_600n;
    const rescueNonce = keccak256(stringToHex("v2-fee-token"));
    await token.write.faucet([source.account.address, amount]);
    const signatures = await signErc2612(
      token.address,
      settlement.address,
      amount,
      0n,
      deadline,
      rescueNonce,
      FEE_TOKEN_NAME,
    );

    await assert.rejects(destination.writeContract({
      address: settlement.address,
      abi: settlement.abi,
      functionName: "settleERC2612",
      args: [
        token.address,
        source.account.address,
        destination.account.address,
        amount,
        0n,
        deadline,
        rescueNonce,
        signatures.permitSignature,
        signatures.rescueSignature,
      ],
    }));
    assert.equal(await token.read.balanceOf([source.account.address]), amount);
    assert.equal(await token.read.balanceOf([destination.account.address]), 0n);
    assert.equal(await token.read.nonces([source.account.address]), 0n);
    assert.equal(await token.read.allowance([source.account.address, settlement.address]), 0n);
    assert.equal(await settlement.read.rescueNonceUsed([source.account.address, rescueNonce]), false);
  });

  it("settles and revokes after a DAI-style allow permit is pre-consumed", async function () {
    const token = await viem.deployContract("SafeExitTestDaiPermit");
    const settlement = await viem.deployContract("SafeExitPermitSettlementV2");
    const amount = parseEther("75");
    const expiry = (await latestTimestamp()) + 3_600n;
    const rescueNonce = keccak256(stringToHex("v2-preconsumed-dai"));
    await token.write.faucet([source.account.address, amount]);
    const allowSignature = await signDaiPermit(token.address, settlement.address, 0n, expiry, true);
    const revokeSignature = await signDaiPermit(token.address, settlement.address, 1n, expiry, false);
    const rescueSignature = await signDaiRescue(
      token.address,
      settlement.address,
      amount,
      0n,
      expiry,
      rescueNonce,
    );
    await outsider.writeContract({
      address: token.address,
      abi: token.abi,
      functionName: "permit",
      args: [
        source.account.address,
        settlement.address,
        0n,
        expiry,
        true,
        allowSignature.v,
        allowSignature.r,
        allowSignature.s,
      ],
    });

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
        allowSignature,
        revokeSignature,
        rescueSignature,
      ],
    });
    assert.equal(await token.read.balanceOf([destination.account.address]), amount);
    assert.equal(await token.read.allowance([source.account.address, settlement.address]), 0n);
    assert.equal(await token.read.nonces([source.account.address]), 2n);
  });

  it("rolls back a DAI-style rescue when revocation is invalid", async function () {
    const token = await viem.deployContract("SafeExitTestDaiPermit");
    const settlement = await viem.deployContract("SafeExitPermitSettlementV2");
    const amount = parseEther("55");
    const expiry = (await latestTimestamp()) + 3_600n;
    const rescueNonce = keccak256(stringToHex("v2-invalid-dai-revoke"));
    await token.write.faucet([source.account.address, amount]);
    const allowSignature = await signDaiPermit(token.address, settlement.address, 0n, expiry, true);
    const invalidRevoke = await signDaiPermit(
      token.address,
      settlement.address,
      1n,
      expiry,
      false,
      outsider,
    );
    const rescueSignature = await signDaiRescue(
      token.address,
      settlement.address,
      amount,
      0n,
      expiry,
      rescueNonce,
    );

    await assert.rejects(destination.writeContract({
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
        allowSignature,
        invalidRevoke,
        rescueSignature,
      ],
    }));
    assert.equal(await token.read.balanceOf([source.account.address]), amount);
    assert.equal(await token.read.balanceOf([destination.account.address]), 0n);
    assert.equal(await token.read.nonces([source.account.address]), 0n);
    assert.equal(await token.read.allowance([source.account.address, settlement.address]), 0n);
    assert.equal(await settlement.read.rescueNonceUsed([source.account.address, rescueNonce]), false);
  });

  it("settles an ERC-4494 rescue and rejects replay", async function () {
    const nft = await viem.deployContract("SafeExitTestERC4494");
    const settlement = await viem.deployContract("SafeExitPermitSettlementV2");
    const tokenId = 1n;
    const deadline = (await latestTimestamp()) + 3_600n;
    const rescueNonce = keccak256(stringToHex("v2-erc4494"));
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
      message: { spender: settlement.address, tokenId, nonce: 0n, deadline },
    });
    const rescueSignature = signatureTuple(await source.signTypedData({
      domain: {
        name: SETTLEMENT_NAME,
        version: SETTLEMENT_VERSION,
        chainId,
        verifyingContract: settlement.address,
      },
      types: erc721RescueTypes,
      primaryType: "ERC721Rescue",
      message: {
        collection: nft.address,
        owner: source.account.address,
        destination: destination.account.address,
        tokenId,
        permitNonce: 0n,
        deadline,
        rescueNonce,
      },
    }));
    const args = [
      nft.address,
      source.account.address,
      destination.account.address,
      tokenId,
      0n,
      deadline,
      rescueNonce,
      permitSignature,
      rescueSignature,
    ] as const;

    await destination.writeContract({
      address: settlement.address,
      abi: settlement.abi,
      functionName: "settleERC4494",
      args,
    });
    assert.equal(await nft.read.ownerOf([tokenId]), getAddress(destination.account.address));
    await assert.rejects(destination.writeContract({
      address: settlement.address,
      abi: settlement.abi,
      functionName: "settleERC4494",
      args,
    }));
  });

  it("settles a mixed ERC-2612 and ERC-4494 rescue through one shared deployment", async function () {
    const token = await viem.deployContract("SafeExitTestERC2612");
    const nft = await viem.deployContract("SafeExitTestERC4494");
    const settlement = await viem.deployContract("SafeExitPermitSettlementV2");
    const amount = parseEther("250");
    const tokenId = 1n;
    const deadline = (await latestTimestamp()) + 3_600n;
    const erc20Nonce = keccak256(stringToHex("v2-mixed-erc20"));
    const nftNonce = keccak256(stringToHex("v2-mixed-nft"));
    await token.write.faucet([source.account.address, amount]);
    await nft.write.faucet([source.account.address]);

    const erc20Signatures = await signErc2612(
      token.address,
      settlement.address,
      amount,
      0n,
      deadline,
      erc20Nonce,
    );
    const nftPermitSignature = await source.signTypedData({
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
      message: { spender: settlement.address, tokenId, nonce: 0n, deadline },
    });
    const nftRescueSignature = signatureTuple(await source.signTypedData({
      domain: {
        name: SETTLEMENT_NAME,
        version: SETTLEMENT_VERSION,
        chainId,
        verifyingContract: settlement.address,
      },
      types: erc721RescueTypes,
      primaryType: "ERC721Rescue",
      message: {
        collection: nft.address,
        owner: source.account.address,
        destination: destination.account.address,
        tokenId,
        permitNonce: 0n,
        deadline,
        rescueNonce: nftNonce,
      },
    }));

    await destination.writeContract({
      address: settlement.address,
      abi: settlement.abi,
      functionName: "settleERC2612",
      args: [
        token.address,
        source.account.address,
        destination.account.address,
        amount,
        0n,
        deadline,
        erc20Nonce,
        erc20Signatures.permitSignature,
        erc20Signatures.rescueSignature,
      ],
    });
    await destination.writeContract({
      address: settlement.address,
      abi: settlement.abi,
      functionName: "settleERC4494",
      args: [
        nft.address,
        source.account.address,
        destination.account.address,
        tokenId,
        0n,
        deadline,
        nftNonce,
        nftPermitSignature,
        nftRescueSignature,
      ],
    });

    assert.equal(await token.read.balanceOf([destination.account.address]), amount);
    assert.equal(await nft.read.ownerOf([tokenId]), getAddress(destination.account.address));
    assert.equal(await token.read.allowance([source.account.address, settlement.address]), 0n);
  });
});
