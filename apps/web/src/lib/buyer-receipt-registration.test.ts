import { describe, expect, it } from "vitest";
import { decodeFunctionData, encodeFunctionData, parseSignature, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import {
  SIGNING_PACKAGE_EIP712_TYPES,
  type SigningPackage,
} from "@safeexit/agent-service";
import {
  PERMIT_KIND_DAI,
  PERMIT_KIND_ERC2612,
  PERMIT_SETTLEMENT_NAME,
  PERMIT_SETTLEMENT_VERSION,
  permitSettlementAbi,
} from "@safeexit/adapters";

import { assertReceiptSubmissionTransaction } from "./buyer-receipt-registration";

const account = privateKeyToAccount(`0x${"11".repeat(32)}`);
const source = account.address;
const destination = "0x2222222222222222222222222222222222222222" as const;
const token = "0x3333333333333333333333333333333333333333" as const;
const settlement = "0x4444444444444444444444444444444444444444" as const;
const other = "0x5555555555555555555555555555555555555555" as const;
const collection = "0x6666666666666666666666666666666666666666" as const;
const nonce = `0x${"66".repeat(32)}` as const;
const rescueNonce = `0x${"77".repeat(32)}` as const;

const receiveWithAuthorizationAbi = [{
  type: "function",
  name: "receiveWithAuthorization",
  stateMutability: "nonpayable",
  inputs: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
    { name: "v", type: "uint8" },
    { name: "r", type: "bytes32" },
    { name: "s", type: "bytes32" },
  ],
  outputs: [],
}] as const;

function parts(signature: Hex) {
  const parsed = parseSignature(signature);
  return {
    v: Number(parsed.v ?? BigInt((parsed.yParity ?? 0) + 27)),
    r: parsed.r,
    s: parsed.s,
  };
}

async function directFixture(): Promise<{ signingPackage: SigningPackage; input: Hex }> {
  const domain = { name: "Test USD", version: "1", chainId: 196, verifyingContract: token };
  const types = { ReceiveWithAuthorization: SIGNING_PACKAGE_EIP712_TYPES.ReceiveWithAuthorization };
  const message = {
    from: source,
    to: destination,
    value: "100",
    validAfter: "1",
    validBefore: "9999999999",
    nonce,
  };
  const signableMessage = {
    ...message,
    value: 100n,
    validAfter: 1n,
    validBefore: 9_999_999_999n,
  };
  const signature = await account.signTypedData({
    domain,
    types,
    primaryType: "ReceiveWithAuthorization",
    message: signableMessage,
  });
  const signatureParts = parts(signature);
  return {
    signingPackage: {
      route: "ERC3009_RECEIVE_WITH_AUTHORIZATION",
      sourceAddress: source,
      destinationAddress: destination,
      tokenAddress: token,
      sourceSigningRequests: [{
        typedData: {
          domain,
          types: {
            EIP712Domain: SIGNING_PACKAGE_EIP712_TYPES.EIP712Domain,
            ...types,
          },
          primaryType: "ReceiveWithAuthorization",
          message,
        },
      }],
    } as unknown as SigningPackage,
    input: encodeFunctionData({
      abi: receiveWithAuthorizationAbi,
      functionName: "receiveWithAuthorization",
      args: [
        source,
        destination,
        100n,
        1n,
        9_999_999_999n,
        nonce,
        signatureParts.v,
        signatureParts.r,
        signatureParts.s,
      ],
    }),
  };
}

async function settlementFixture(): Promise<{ signingPackage: SigningPackage; input: Hex }> {
  const deadline = "9999999999";
  const permitDomain = { name: "Test Token", version: "1", chainId: 196, verifyingContract: token };
  const permitTypes = { Permit: SIGNING_PACKAGE_EIP712_TYPES.ERC2612Permit };
  const permitMessage = {
    owner: source,
    spender: settlement,
    value: "100",
    nonce: "3",
    deadline,
  };
  const signablePermitMessage = {
    ...permitMessage,
    value: 100n,
    nonce: 3n,
    deadline: BigInt(deadline),
  };
  const rescueDomain = {
    name: PERMIT_SETTLEMENT_NAME,
    version: PERMIT_SETTLEMENT_VERSION,
    chainId: 196,
    verifyingContract: settlement,
  };
  const rescueTypes = { ERC20Rescue: SIGNING_PACKAGE_EIP712_TYPES.ERC20Rescue };
  const rescueMessage = {
    token,
    owner: source,
    destination,
    amount: "100",
    permitNonce: "3",
    deadline,
    rescueNonce,
    permitKind: PERMIT_KIND_ERC2612,
  };
  const signableRescueMessage = {
    ...rescueMessage,
    amount: 100n,
    permitNonce: 3n,
    deadline: BigInt(deadline),
  };
  const [permitSignature, rescueSignature] = await Promise.all([
    account.signTypedData({
      domain: permitDomain,
      types: permitTypes,
      primaryType: "Permit",
      message: signablePermitMessage,
    }),
    account.signTypedData({
      domain: rescueDomain,
      types: rescueTypes,
      primaryType: "ERC20Rescue",
      message: signableRescueMessage,
    }),
  ]);
  const permit = parts(permitSignature);
  const rescue = parts(rescueSignature);
  return {
    signingPackage: {
      route: "ERC2612_PERMIT_SETTLEMENT",
      sourceAddress: source,
      destinationAddress: destination,
      tokenAddress: token,
      settlementContract: settlement,
      amount: "100",
      sourceSigningRequests: [
        {
          typedData: {
            domain: permitDomain,
            types: { EIP712Domain: SIGNING_PACKAGE_EIP712_TYPES.EIP712Domain, ...permitTypes },
            primaryType: "Permit",
            message: permitMessage,
          },
        },
        {
          typedData: {
            domain: rescueDomain,
            types: { EIP712Domain: SIGNING_PACKAGE_EIP712_TYPES.EIP712Domain, ...rescueTypes },
            primaryType: "ERC20Rescue",
            message: rescueMessage,
          },
        },
      ],
    } as unknown as SigningPackage,
    input: encodeFunctionData({
      abi: permitSettlementAbi,
      functionName: "settleERC2612",
      args: [token, source, destination, 100n, 3n, BigInt(deadline), rescueNonce, permit, rescue],
    }),
  };
}

async function daiFixture(): Promise<{ signingPackage: SigningPackage; input: Hex }> {
  const expiry = "9999999999";
  const domain = { name: "Dai Stablecoin", version: "1", chainId: 196, verifyingContract: token };
  const types = { Permit: SIGNING_PACKAGE_EIP712_TYPES.DaiPermit };
  const allowMessage = {
    holder: source,
    spender: settlement,
    nonce: "5",
    expiry,
    allowed: true,
  };
  const revokeMessage = { ...allowMessage, nonce: "6", allowed: false };
  const rescueDomain = {
    name: PERMIT_SETTLEMENT_NAME,
    version: PERMIT_SETTLEMENT_VERSION,
    chainId: 196,
    verifyingContract: settlement,
  };
  const rescueTypes = { ERC20Rescue: SIGNING_PACKAGE_EIP712_TYPES.ERC20Rescue };
  const rescueMessage = {
    token,
    owner: source,
    destination,
    amount: "100",
    permitNonce: "5",
    deadline: expiry,
    rescueNonce,
    permitKind: PERMIT_KIND_DAI,
  };
  const [allowSignature, revokeSignature, rescueSignature] = await Promise.all([
    account.signTypedData({
      domain,
      types,
      primaryType: "Permit",
      message: { ...allowMessage, nonce: 5n, expiry: BigInt(expiry) },
    }),
    account.signTypedData({
      domain,
      types,
      primaryType: "Permit",
      message: { ...revokeMessage, nonce: 6n, expiry: BigInt(expiry) },
    }),
    account.signTypedData({
      domain: rescueDomain,
      types: rescueTypes,
      primaryType: "ERC20Rescue",
      message: {
        ...rescueMessage,
        amount: 100n,
        permitNonce: 5n,
        deadline: BigInt(expiry),
      },
    }),
  ]);
  const allow = parts(allowSignature);
  const revoke = parts(revokeSignature);
  const rescue = parts(rescueSignature);
  const signingPackage = {
    route: "DAI_PERMIT_SETTLEMENT",
    sourceAddress: source,
    destinationAddress: destination,
    tokenAddress: token,
    settlementContract: settlement,
    amount: "100",
    sourceSigningRequests: [
      {
        typedData: {
          domain,
          types: { EIP712Domain: SIGNING_PACKAGE_EIP712_TYPES.EIP712Domain, ...types },
          primaryType: "Permit",
          message: allowMessage,
        },
      },
      {
        typedData: {
          domain,
          types: { EIP712Domain: SIGNING_PACKAGE_EIP712_TYPES.EIP712Domain, ...types },
          primaryType: "Permit",
          message: revokeMessage,
        },
      },
      {
        typedData: {
          domain: rescueDomain,
          types: { EIP712Domain: SIGNING_PACKAGE_EIP712_TYPES.EIP712Domain, ...rescueTypes },
          primaryType: "ERC20Rescue",
          message: rescueMessage,
        },
      },
    ],
  } as unknown as SigningPackage;
  return {
    signingPackage,
    input: encodeFunctionData({
      abi: permitSettlementAbi,
      functionName: "settleDaiPermit",
      args: [token, source, destination, 100n, 5n, BigInt(expiry), rescueNonce, allow, revoke, rescue],
    }),
  };
}

async function nftFixture(): Promise<{ signingPackage: SigningPackage; input: Hex }> {
  const deadline = "9999999999";
  const permitDomain = { name: "Rescue NFT", version: "1", chainId: 196, verifyingContract: collection };
  const permitTypes = { Permit: SIGNING_PACKAGE_EIP712_TYPES.ERC4494Permit };
  const permitMessage = { spender: settlement, tokenId: "42", nonce: "9", deadline };
  const nftRescueNonce = `0x${"88".repeat(32)}` as const;
  const rescueDomain = {
    name: PERMIT_SETTLEMENT_NAME,
    version: PERMIT_SETTLEMENT_VERSION,
    chainId: 196,
    verifyingContract: settlement,
  };
  const rescueTypes = { ERC721Rescue: SIGNING_PACKAGE_EIP712_TYPES.ERC721Rescue };
  const rescueMessage = {
    collection,
    owner: source,
    destination,
    tokenId: "42",
    permitNonce: "9",
    deadline,
    rescueNonce: nftRescueNonce,
  };
  const [permitSignature, rescueSignature] = await Promise.all([
    account.signTypedData({
      domain: permitDomain,
      types: permitTypes,
      primaryType: "Permit",
      message: { ...permitMessage, tokenId: 42n, nonce: 9n, deadline: BigInt(deadline) },
    }),
    account.signTypedData({
      domain: rescueDomain,
      types: rescueTypes,
      primaryType: "ERC721Rescue",
      message: {
        ...rescueMessage,
        tokenId: 42n,
        permitNonce: 9n,
        deadline: BigInt(deadline),
      },
    }),
  ]);
  const rescue = parts(rescueSignature);
  const signingPackage = {
    route: "ERC4494_PERMIT_SETTLEMENT",
    sourceAddress: source,
    destinationAddress: destination,
    collectionAddress: collection,
    settlementContract: settlement,
    tokenId: "42",
    sourceSigningRequests: [
      {
        typedData: {
          domain: permitDomain,
          types: { EIP712Domain: SIGNING_PACKAGE_EIP712_TYPES.EIP712Domain, ...permitTypes },
          primaryType: "Permit",
          message: permitMessage,
        },
      },
      {
        typedData: {
          domain: rescueDomain,
          types: { EIP712Domain: SIGNING_PACKAGE_EIP712_TYPES.EIP712Domain, ...rescueTypes },
          primaryType: "ERC721Rescue",
          message: rescueMessage,
        },
      },
    ],
  } as unknown as SigningPackage;
  return {
    signingPackage,
    input: encodeFunctionData({
      abi: permitSettlementAbi,
      functionName: "settleERC4494",
      args: [
        collection,
        source,
        destination,
        42n,
        9n,
        BigInt(deadline),
        nftRescueNonce,
        permitSignature,
        rescue,
      ],
    }),
  };
}

describe("buyer receipt registration", () => {
  it("accepts only canonical destination-submitted calls signed by the source", async () => {
    const direct = await directFixture();
    const settled = await settlementFixture();
    const dai = await daiFixture();
    const nft = await nftFixture();

    await expect(assertReceiptSubmissionTransaction(direct.signingPackage, {
      from: destination,
      to: token,
      value: 0n,
      input: direct.input,
    })).resolves.toBeUndefined();
    await expect(assertReceiptSubmissionTransaction(settled.signingPackage, {
      from: destination,
      to: settlement,
      value: 0n,
      input: settled.input,
    })).resolves.toBeUndefined();
    await expect(assertReceiptSubmissionTransaction(dai.signingPackage, {
      from: destination,
      to: settlement,
      value: 0n,
      input: dai.input,
    })).resolves.toBeUndefined();
    await expect(assertReceiptSubmissionTransaction(nft.signingPackage, {
      from: destination,
      to: settlement,
      value: 0n,
      input: nft.input,
    })).resolves.toBeUndefined();
  });

  it("rejects another sender, another target, and native value", async () => {
    const direct = await directFixture();
    await expect(assertReceiptSubmissionTransaction(direct.signingPackage, {
      from: other,
      to: token,
      value: 0n,
      input: direct.input,
    })).rejects.toThrow("committed destination");
    await expect(assertReceiptSubmissionTransaction(direct.signingPackage, {
      from: destination,
      to: other,
      value: 0n,
      input: direct.input,
    })).rejects.toThrow("issued recovery route");
    await expect(assertReceiptSubmissionTransaction(direct.signingPackage, {
      from: destination,
      to: token,
      value: 1n,
      input: direct.input,
    })).rejects.toThrow("native value");
  });

  it("rejects calldata whose committed amount was changed", async () => {
    const direct = await directFixture();
    const decoded = decodeFunctionData({ abi: receiveWithAuthorizationAbi, data: direct.input });
    if (decoded.functionName !== "receiveWithAuthorization") {
      throw new Error("Expected direct authorization fixture");
    }
    const [, , , , , , v, r, s] = decoded.args;
    const tampered = encodeFunctionData({
      abi: receiveWithAuthorizationAbi,
      functionName: "receiveWithAuthorization",
      args: [source, destination, 101n, 1n, 9_999_999_999n, nonce, v, r, s],
    });
    await expect(assertReceiptSubmissionTransaction(direct.signingPackage, {
      from: destination,
      to: token,
      value: 0n,
      input: tampered,
    })).rejects.toThrow("does not match");
  });
});
