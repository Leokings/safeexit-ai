import {
  decodeFunctionData,
  encodeFunctionData,
  getAddress,
  recoverTypedDataAddress,
  type Hex,
} from "viem";

import type { SigningPackage } from "@safeexit/agent-service";
import { permitSettlementAbi } from "@safeexit/adapters";

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

function sameAddress(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function sameHex(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

type SignatureParts = Readonly<{ v: number; r: Hex; s: Hex }>;

function signatureHex(parts: SignatureParts): Hex {
  if (
    (parts.v !== 27 && parts.v !== 28) ||
    !/^0x[a-fA-F0-9]{64}$/.test(parts.r) ||
    !/^0x[a-fA-F0-9]{64}$/.test(parts.s)
  ) {
    throw new Error("Receipt calldata contains an invalid authorization signature");
  }
  return `${parts.r}${parts.s.slice(2)}${parts.v.toString(16).padStart(2, "0")}` as Hex;
}

async function assertSourceSignature(
  request: SigningPackage["sourceSigningRequests"][number],
  signature: Hex,
  sourceAddress: string,
): Promise<void> {
  if (!/^0x[a-fA-F0-9]{130}$/.test(signature)) {
    throw new Error("Receipt calldata contains an invalid authorization signature");
  }
  const types = {
    ...request.typedData.types,
  } as Record<string, readonly { name: string; type: string }[]>;
  delete types.EIP712Domain;
  const recovered = await recoverTypedDataAddress({
    domain: {
      ...request.typedData.domain,
      verifyingContract: getAddress(request.typedData.domain.verifyingContract),
    },
    types,
    primaryType: request.typedData.primaryType,
    message: request.typedData.message,
    signature,
  });
  if (!sameAddress(recovered, sourceAddress)) {
    throw new Error("Receipt authorization does not recover to the committed source");
  }
}

function assertCanonicalCall(actual: Hex, canonical: Hex): void {
  if (!sameHex(actual, canonical)) {
    throw new Error("Receipt calldata is not the canonical issued recovery call");
  }
}

export type ReceiptSubmissionTransaction = {
  from: string;
  to: string | null;
  value: bigint;
  input: Hex;
};

export async function assertReceiptSubmissionTransaction(
  signingPackage: SigningPackage,
  transaction: ReceiptSubmissionTransaction,
): Promise<void> {
  if (!sameAddress(transaction.from, signingPackage.destinationAddress)) {
    throw new Error("Receipt transaction was not submitted by the committed destination");
  }
  if (!transaction.to) {
    throw new Error("Receipt transaction cannot be a contract deployment");
  }
  const expectedTarget = signingPackage.route === "ERC3009_RECEIVE_WITH_AUTHORIZATION"
    ? signingPackage.tokenAddress
    : signingPackage.settlementContract;
  if (!sameAddress(transaction.to, expectedTarget)) {
    throw new Error("Receipt transaction target does not match the issued recovery route");
  }
  if (transaction.value !== 0n) {
    throw new Error("Destination-paid settlement must not transfer native value");
  }

  if (signingPackage.route === "ERC3009_RECEIVE_WITH_AUTHORIZATION") {
    const decoded = decodeFunctionData({
      abi: receiveWithAuthorizationAbi,
      data: transaction.input,
    });
    if (decoded.functionName !== "receiveWithAuthorization") {
      throw new Error("Receipt calldata does not call the issued ERC-3009 route");
    }
    const [from, to, value, validAfter, validBefore, nonce, v, r, s] = decoded.args;
    const message = signingPackage.sourceSigningRequests[0].typedData.message;
    if (
      !sameAddress(from, message.from) ||
      !sameAddress(to, message.to) ||
      value !== BigInt(message.value) ||
      validAfter !== BigInt(message.validAfter) ||
      validBefore !== BigInt(message.validBefore) ||
      !sameHex(nonce, message.nonce)
    ) {
      throw new Error("Receipt calldata does not match the issued ERC-3009 authorization");
    }
    const canonical = encodeFunctionData({
      abi: receiveWithAuthorizationAbi,
      functionName: "receiveWithAuthorization",
      args: [from, to, value, validAfter, validBefore, nonce, v, r, s],
    });
    assertCanonicalCall(transaction.input, canonical);
    await assertSourceSignature(
      signingPackage.sourceSigningRequests[0],
      signatureHex({ v, r, s }),
      signingPackage.sourceAddress,
    );
    return;
  }

  const decoded = decodeFunctionData({ abi: permitSettlementAbi, data: transaction.input });
  if (signingPackage.route === "ERC2612_PERMIT_SETTLEMENT") {
    if (decoded.functionName !== "settleERC2612") {
      throw new Error("Receipt calldata does not call the issued ERC-2612 route");
    }
    const [token, owner, destination, amount, permitNonce, deadline, rescueNonce, permit, rescue] =
      decoded.args;
    const committed = signingPackage.sourceSigningRequests[1].typedData.message;
    if (
      !sameAddress(token, committed.token) ||
      !sameAddress(owner, committed.owner) ||
      !sameAddress(destination, committed.destination) ||
      amount !== BigInt(committed.amount) ||
      permitNonce !== BigInt(committed.permitNonce) ||
      deadline !== BigInt(committed.deadline) ||
      !sameHex(rescueNonce, committed.rescueNonce)
    ) {
      throw new Error("Receipt calldata does not match the issued ERC-2612 settlement");
    }
    assertCanonicalCall(transaction.input, encodeFunctionData({
      abi: permitSettlementAbi,
      functionName: "settleERC2612",
      args: [token, owner, destination, amount, permitNonce, deadline, rescueNonce, permit, rescue],
    }));
    await Promise.all([
      assertSourceSignature(signingPackage.sourceSigningRequests[0], signatureHex(permit), signingPackage.sourceAddress),
      assertSourceSignature(signingPackage.sourceSigningRequests[1], signatureHex(rescue), signingPackage.sourceAddress),
    ]);
    return;
  }

  if (signingPackage.route === "DAI_PERMIT_SETTLEMENT") {
    if (decoded.functionName !== "settleDaiPermit") {
      throw new Error("Receipt calldata does not call the issued DAI permit route");
    }
    const [token, holder, destination, amount, allowNonce, expiry, rescueNonce, allow, revoke, rescue] =
      decoded.args;
    const committed = signingPackage.sourceSigningRequests[2].typedData.message;
    if (
      !sameAddress(token, committed.token) ||
      !sameAddress(holder, committed.owner) ||
      !sameAddress(destination, committed.destination) ||
      amount !== BigInt(committed.amount) ||
      allowNonce !== BigInt(committed.permitNonce) ||
      expiry !== BigInt(committed.deadline) ||
      !sameHex(rescueNonce, committed.rescueNonce)
    ) {
      throw new Error("Receipt calldata does not match the issued DAI permit settlement");
    }
    assertCanonicalCall(transaction.input, encodeFunctionData({
      abi: permitSettlementAbi,
      functionName: "settleDaiPermit",
      args: [token, holder, destination, amount, allowNonce, expiry, rescueNonce, allow, revoke, rescue],
    }));
    await Promise.all([
      assertSourceSignature(signingPackage.sourceSigningRequests[0], signatureHex(allow), signingPackage.sourceAddress),
      assertSourceSignature(signingPackage.sourceSigningRequests[1], signatureHex(revoke), signingPackage.sourceAddress),
      assertSourceSignature(signingPackage.sourceSigningRequests[2], signatureHex(rescue), signingPackage.sourceAddress),
    ]);
    return;
  }

  if (decoded.functionName !== "settleERC4494") {
    throw new Error("Receipt calldata does not call the issued ERC-4494 route");
  }
  const [collection, owner, destination, tokenId, permitNonce, deadline, rescueNonce, permit, rescue] =
    decoded.args;
  const committed = signingPackage.sourceSigningRequests[1].typedData.message;
  if (
    !sameAddress(collection, committed.collection) ||
    !sameAddress(owner, committed.owner) ||
    !sameAddress(destination, committed.destination) ||
    tokenId !== BigInt(committed.tokenId) ||
    permitNonce !== BigInt(committed.permitNonce) ||
    deadline !== BigInt(committed.deadline) ||
    !sameHex(rescueNonce, committed.rescueNonce)
  ) {
    throw new Error("Receipt calldata does not match the issued ERC-4494 settlement");
  }
  assertCanonicalCall(transaction.input, encodeFunctionData({
    abi: permitSettlementAbi,
    functionName: "settleERC4494",
    args: [collection, owner, destination, tokenId, permitNonce, deadline, rescueNonce, permit, rescue],
  }));
  await Promise.all([
    assertSourceSignature(signingPackage.sourceSigningRequests[0], permit, signingPackage.sourceAddress),
    assertSourceSignature(signingPackage.sourceSigningRequests[1], signatureHex(rescue), signingPackage.sourceAddress),
  ]);
}
