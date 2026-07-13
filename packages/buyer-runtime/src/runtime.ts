import {
  encodeFunctionData,
  getAddress,
  parseSignature,
  recoverTypedDataAddress,
  type Address,
  type Hex,
} from "viem";

import {
  buyerExecutionReportSchema,
  signingPackageSchema,
  type BuyerExecutionReport,
  type SigningPackage,
} from "@safeexit/agent-service";

import type {
  AtomicSettlementSimulatorPort,
  DestinationSettlementWalletPort,
  LocalSourceSignerPort,
  SettlementBatch,
  SourceSigningRequest,
} from "./ports";
import {
  buyerConfirmationSchema,
  destinationReceiptSchema,
  destinationSubmissionSchema,
  settlementCallSchema,
  settlementSimulationSchema,
  type BuyerConfirmation,
  type SettlementCall,
} from "./schemas";

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

const erc2612Abi = [
  {
    type: "function",
    name: "permit",
    stateMutability: "nonpayable",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
      { name: "value", type: "uint256" },
      { name: "deadline", type: "uint256" },
      { name: "v", type: "uint8" },
      { name: "r", type: "bytes32" },
      { name: "s", type: "bytes32" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "transferFrom",
    stateMutability: "nonpayable",
    inputs: [
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

const daiPermitAbi = [
  {
    type: "function",
    name: "permit",
    stateMutability: "nonpayable",
    inputs: [
      { name: "holder", type: "address" },
      { name: "spender", type: "address" },
      { name: "nonce", type: "uint256" },
      { name: "expiry", type: "uint256" },
      { name: "allowed", type: "bool" },
      { name: "v", type: "uint8" },
      { name: "r", type: "bytes32" },
      { name: "s", type: "bytes32" },
    ],
    outputs: [],
  },
  erc2612Abi[1],
] as const;

const erc4494Abi = [
  {
    type: "function",
    name: "permit",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "tokenId", type: "uint256" },
      { name: "deadline", type: "uint256" },
      { name: "signature", type: "bytes" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "transferFrom",
    stateMutability: "nonpayable",
    inputs: [
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "tokenId", type: "uint256" },
    ],
    outputs: [],
  },
] as const;

export type BuyerRuntimeErrorCode =
  | "INVALID_CONFIRMATION"
  | "PACKAGE_EXPIRED"
  | "SOURCE_MISMATCH"
  | "INVALID_SIGNATURE"
  | "INVALID_HANDLE"
  | "DESTINATION_MISMATCH"
  | "CHAIN_MISMATCH"
  | "ATOMIC_BATCH_UNAVAILABLE"
  | "SIMULATION_FAILED"
  | "SUBMISSION_FAILED";

export class BuyerRuntimeError extends Error {
  constructor(
    readonly code: BuyerRuntimeErrorCode,
    message: string,
    readonly transactionHashes: readonly string[] = [],
  ) {
    super(message);
    this.name = "BuyerRuntimeError";
  }
}

export type AuthorizedSettlementSummary = {
  packageId: string;
  route: SigningPackage["route"];
  chainId: number;
  sourceAddress: SigningPackage["sourceAddress"];
  destinationAddress: SigningPackage["destinationAddress"];
  expiresAt: string;
  operationCount: number;
  authorizedAt: string;
};

export type AuthorizedSettlementHandle = Readonly<{
  summary: Readonly<AuthorizedSettlementSummary>;
}>;

type AuthorizedState = {
  signingPackage: SigningPackage;
  calls: readonly SettlementCall[];
};

const authorizedStates = new WeakMap<AuthorizedSettlementHandle, AuthorizedState>();

function sameAddress(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function assertFresh(signingPackage: SigningPackage, now: Date): void {
  const expiresAt = Date.parse(signingPackage.expiresAt);
  if (expiresAt <= now.getTime()) {
    throw new BuyerRuntimeError("PACKAGE_EXPIRED", "The signing package has expired");
  }
  if (expiresAt - now.getTime() > 300_000) {
    throw new BuyerRuntimeError(
      "PACKAGE_EXPIRED",
      "The signing package exceeds the maximum five-minute authorization window",
    );
  }
  if (signingPackage.route === "ERC3009_RECEIVE_WITH_AUTHORIZATION") {
    const message = signingPackage.sourceSigningRequests[0].typedData.message;
    const nowSeconds = BigInt(Math.floor(now.getTime() / 1_000));
    if (
      nowSeconds <= BigInt(message.validAfter) ||
      nowSeconds >= BigInt(message.validBefore)
    ) {
      throw new BuyerRuntimeError(
        "PACKAGE_EXPIRED",
        "The ERC-3009 authorization is not active at the current time",
      );
    }
  }
}

function validateConfirmation(
  signingPackage: SigningPackage,
  value: BuyerConfirmation,
): void {
  const confirmation = buyerConfirmationSchema.parse(value);
  if (
    confirmation.packageId !== signingPackage.packageId ||
    confirmation.planHash.toLowerCase() !== signingPackage.planHash.toLowerCase() ||
    confirmation.chainId !== signingPackage.chainId ||
    !sameAddress(confirmation.sourceAddress, signingPackage.sourceAddress) ||
    !sameAddress(confirmation.destinationAddress, signingPackage.destinationAddress)
  ) {
    throw new BuyerRuntimeError(
      "INVALID_CONFIRMATION",
      "Buyer confirmation does not match the signing package",
    );
  }
}

function signatureParts(signature: Hex) {
  if (!/^0x[a-fA-F0-9]{130}$/.test(signature)) {
    throw new BuyerRuntimeError("INVALID_SIGNATURE", "Signer returned an invalid signature");
  }
  const parsed = parseSignature(signature);
  return {
    v: Number(parsed.v ?? BigInt((parsed.yParity ?? 0) + 27)),
    r: parsed.r,
    s: parsed.s,
  };
}

async function recoverRequestSigner(
  request: SourceSigningRequest,
  signature: Hex,
): Promise<`0x${string}`> {
  const domain = {
    ...request.typedData.domain,
    verifyingContract: getAddress(request.typedData.domain.verifyingContract),
  };
  const types = { ...request.typedData.types } as Record<string, readonly { name: string; type: string }[]>;
  delete types.EIP712Domain;
  return recoverTypedDataAddress({
    domain,
    types,
    primaryType: request.typedData.primaryType,
    message: request.typedData.message,
    signature,
  });
}

async function signAndVerify(
  signingPackage: SigningPackage,
  signer: LocalSourceSignerPort,
): Promise<readonly Hex[]> {
  const signerAddress = getAddress(await signer.getAddress());
  if (!sameAddress(signerAddress, signingPackage.sourceAddress)) {
    throw new BuyerRuntimeError(
      "SOURCE_MISMATCH",
      "The active source signer does not match the committed source wallet",
    );
  }
  const signatures: Hex[] = [];
  for (const request of signingPackage.sourceSigningRequests) {
    const signature = await signer.signTypedData(request);
    signatureParts(signature);
    const recovered = await recoverRequestSigner(request, signature);
    if (!sameAddress(recovered, signingPackage.sourceAddress)) {
      throw new BuyerRuntimeError(
        "INVALID_SIGNATURE",
        "A source authorization does not recover to the committed source wallet",
      );
    }
    signatures.push(signature);
  }
  return signatures;
}

function address(value: string): Address {
  return getAddress(value);
}

function call(to: string, data: Hex): SettlementCall {
  return settlementCallSchema.parse({ to: address(to), value: "0x0", data });
}

function assembleCalls(
  signingPackage: SigningPackage,
  signatures: readonly Hex[],
): readonly SettlementCall[] {
  if (signingPackage.route === "ERC3009_RECEIVE_WITH_AUTHORIZATION") {
    const signature = signatures[0];
    if (!signature) throw new BuyerRuntimeError("INVALID_SIGNATURE", "Missing ERC-3009 signature");
    const { v, r, s } = signatureParts(signature);
    const message = signingPackage.sourceSigningRequests[0].typedData.message;
    return [call(signingPackage.tokenAddress, encodeFunctionData({
      abi: receiveWithAuthorizationAbi,
      functionName: "receiveWithAuthorization",
      args: [
        address(message.from),
        address(message.to),
        BigInt(message.value),
        BigInt(message.validAfter),
        BigInt(message.validBefore),
        message.nonce as Hex,
        v,
        r,
        s,
      ],
    }))];
  }
  if (signingPackage.route === "ERC2612_PERMIT_ATOMIC_BATCH") {
    const signature = signatures[0];
    if (!signature) throw new BuyerRuntimeError("INVALID_SIGNATURE", "Missing ERC-2612 signature");
    const { v, r, s } = signatureParts(signature);
    const message = signingPackage.sourceSigningRequests[0].typedData.message;
    return [
      call(signingPackage.tokenAddress, encodeFunctionData({
        abi: erc2612Abi,
        functionName: "permit",
        args: [
          address(message.owner),
          address(message.spender),
          BigInt(message.value),
          BigInt(message.deadline),
          v,
          r,
          s,
        ],
      })),
      call(signingPackage.tokenAddress, encodeFunctionData({
        abi: erc2612Abi,
        functionName: "transferFrom",
        args: [address(message.owner), address(message.spender), BigInt(message.value)],
      })),
    ];
  }
  if (signingPackage.route === "DAI_PERMIT_ATOMIC_BATCH") {
    const allowSignature = signatures[0];
    const revokeSignature = signatures[1];
    if (!allowSignature || !revokeSignature) {
      throw new BuyerRuntimeError("INVALID_SIGNATURE", "Missing DAI-style signatures");
    }
    const allowParts = signatureParts(allowSignature);
    const revokeParts = signatureParts(revokeSignature);
    const allow = signingPackage.sourceSigningRequests[0].typedData.message;
    const revoke = signingPackage.sourceSigningRequests[1].typedData.message;
    return [
      call(signingPackage.tokenAddress, encodeFunctionData({
        abi: daiPermitAbi,
        functionName: "permit",
        args: [
          address(allow.holder),
          address(allow.spender),
          BigInt(allow.nonce),
          BigInt(allow.expiry),
          true,
          allowParts.v,
          allowParts.r,
          allowParts.s,
        ],
      })),
      call(signingPackage.tokenAddress, encodeFunctionData({
        abi: daiPermitAbi,
        functionName: "transferFrom",
        args: [address(allow.holder), address(allow.spender), BigInt(signingPackage.amount)],
      })),
      call(signingPackage.tokenAddress, encodeFunctionData({
        abi: daiPermitAbi,
        functionName: "permit",
        args: [
          address(revoke.holder),
          address(revoke.spender),
          BigInt(revoke.nonce),
          BigInt(revoke.expiry),
          false,
          revokeParts.v,
          revokeParts.r,
          revokeParts.s,
        ],
      })),
    ];
  }
  const signature = signatures[0];
  if (!signature) throw new BuyerRuntimeError("INVALID_SIGNATURE", "Missing ERC-4494 signature");
  const message = signingPackage.sourceSigningRequests[0].typedData.message;
  return [
    call(signingPackage.collectionAddress, encodeFunctionData({
      abi: erc4494Abi,
      functionName: "permit",
      args: [address(message.spender), BigInt(message.tokenId), BigInt(message.deadline), signature],
    })),
    call(signingPackage.collectionAddress, encodeFunctionData({
      abi: erc4494Abi,
      functionName: "transferFrom",
      args: [
        address(signingPackage.sourceAddress),
        address(signingPackage.destinationAddress),
        BigInt(message.tokenId),
      ],
    })),
  ];
}

export class BuyerRescueRuntime {
  constructor(private readonly clock: () => Date = () => new Date()) {}

  async authorize(
    packageValue: SigningPackage,
    confirmationValue: BuyerConfirmation,
    signer: LocalSourceSignerPort,
  ): Promise<AuthorizedSettlementHandle> {
    const signingPackage = signingPackageSchema.parse(packageValue);
    const now = this.clock();
    assertFresh(signingPackage, now);
    validateConfirmation(signingPackage, confirmationValue);
    const signatures = await signAndVerify(signingPackage, signer);
    assertFresh(signingPackage, this.clock());
    const calls = Object.freeze([...assembleCalls(signingPackage, signatures)]);
    const handle = Object.freeze({
      summary: Object.freeze({
        packageId: signingPackage.packageId,
        route: signingPackage.route,
        chainId: signingPackage.chainId,
        sourceAddress: signingPackage.sourceAddress,
        destinationAddress: signingPackage.destinationAddress,
        expiresAt: signingPackage.expiresAt,
        operationCount: calls.length,
        authorizedAt: now.toISOString(),
      }),
    });
    authorizedStates.set(handle, { signingPackage, calls });
    return handle;
  }

  async execute(
    handle: AuthorizedSettlementHandle,
    simulator: AtomicSettlementSimulatorPort,
    wallet: DestinationSettlementWalletPort,
  ): Promise<BuyerExecutionReport> {
    const state = authorizedStates.get(handle);
    if (!state) {
      throw new BuyerRuntimeError(
        "INVALID_HANDLE",
        "Authorization is unavailable, consumed, or was serialized outside this runtime",
      );
    }
    const { signingPackage, calls } = state;
    assertFresh(signingPackage, this.clock());
    const destination = getAddress(await wallet.getAddress());
    if (!sameAddress(destination, signingPackage.destinationAddress)) {
      throw new BuyerRuntimeError(
        "DESTINATION_MISMATCH",
        "The active destination wallet does not match the committed destination",
      );
    }
    if (await wallet.getChainId() !== signingPackage.chainId) {
      throw new BuyerRuntimeError("CHAIN_MISMATCH", "Destination wallet is on the wrong chain");
    }
    if (
      signingPackage.destinationSettlement.atomicRequired &&
      !(await wallet.supportsAtomicBatch(signingPackage.chainId, destination))
    ) {
      throw new BuyerRuntimeError(
        "ATOMIC_BATCH_UNAVAILABLE",
        "Destination wallet does not guarantee atomic execution for this route",
      );
    }
    const batch: SettlementBatch = Object.freeze({
      packageId: signingPackage.packageId,
      chainId: signingPackage.chainId,
      from: destination,
      atomicRequired: signingPackage.destinationSettlement.atomicRequired,
      calls,
    });
    const simulation = settlementSimulationSchema.parse(await simulator.simulate(batch));
    if (simulation.callCount !== calls.length || simulation.status !== "SUCCEEDED") {
      throw new BuyerRuntimeError(
        "SIMULATION_FAILED",
        simulation.failureReason ?? "Post-signature settlement simulation failed",
      );
    }
    assertFresh(signingPackage, this.clock());
    authorizedStates.delete(handle);
    const submission = destinationSubmissionSchema.parse(await wallet.submit(batch));
    const receipt = destinationReceiptSchema.parse(await wallet.waitForReceipt(submission));
    if (receipt.status !== "CONFIRMED") {
      throw new BuyerRuntimeError(
        "SUBMISSION_FAILED",
        receipt.failureReason ?? "Destination-paid settlement failed",
        receipt.transactionHashes,
      );
    }
    return buyerExecutionReportSchema.parse({
      schemaVersion: "safeexit-buyer-report-v1",
      packageId: signingPackage.packageId,
      jobId: signingPackage.jobId,
      incidentId: signingPackage.incidentId,
      planId: signingPackage.planId,
      planHash: signingPackage.planHash,
      actionId: signingPackage.actionId,
      route: signingPackage.route,
      chainId: signingPackage.chainId,
      sourceAddress: signingPackage.sourceAddress,
      destinationAddress: signingPackage.destinationAddress,
      status: "COMPLETED",
      simulationProviderId: simulation.providerId,
      simulatedAt: simulation.simulatedAt,
      transactionHashes: receipt.transactionHashes,
      completedAt: receipt.observedAt,
    });
  }
}
