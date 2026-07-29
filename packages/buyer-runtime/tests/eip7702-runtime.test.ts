import {
  EIP7702_ACTION_KIND,
  EIP7702_FULL_BALANCE,
  hashEip7702RescuePlan,
} from "@safeexit/adapters";
import {
  getAddress,
  type Hex,
  type SignedAuthorization,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";

import {
  Eip7702RuntimeError,
  LocalEip7702RescueRuntime,
  ViemLocalEip7702SourceSigner,
  XLAYER_SAFEEXIT_EIP7702_FACTORY_V2,
  eip7702LocalSigningPackageSchema,
  type DestinationReceipt,
  type Eip7702DestinationTransportPort,
  type Eip7702LocalSigningPackage,
  type Eip7702LocalTransactionRequest,
  type Eip7702PackageInspection,
} from "../src";

const sourceAccount = privateKeyToAccount(
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
);
const destinationAccount = privateKeyToAccount(
  "0x59c6995e998f97a5a0044976f7d7f9f57f8f149ca2a5c6bede10b1b2b9f2d9b8",
);
const otherAccount = privateKeyToAccount(
  "0x5de4111afa1c4b3daadb3f66a98a2c087b53aaf3d5cbd3e20eec2f248b3d9e55",
);
const factoryAddress = "0x1000000000000000000000000000000000000001";
const delegateAddress = "0x2000000000000000000000000000000000000002";
const tokenAddress = "0x3000000000000000000000000000000000000003";
const factoryRuntimeHash = `0x${"44".repeat(32)}` as Hex;
const plannerPlanHash = `0x${"55".repeat(32)}` as Hex;
const rescueNonce = `0x${"66".repeat(32)}` as Hex;
const deploymentHash = `0x${"71".repeat(32)}` as Hex;
const rescueHashOne = `0x${"72".repeat(32)}` as Hex;
const rescueHashTwo = `0x${"73".repeat(32)}` as Hex;
const clearHash = `0x${"74".repeat(32)}` as Hex;
const blockHash = `0x${"88".repeat(32)}` as Hex;
const now = new Date("2026-07-23T10:00:00.000Z");
const expiresAt = "2026-07-23T10:10:00.000Z";

function packageValue(): Eip7702LocalSigningPackage {
  const actions = [
    {
      kind: EIP7702_ACTION_KIND.TRANSFER_NATIVE,
      asset: "0x0000000000000000000000000000000000000000",
      counterparty: destinationAccount.address,
      tokenId: "0",
      amount: EIP7702_FULL_BALANCE.toString(),
    },
    {
      kind: EIP7702_ACTION_KIND.TRANSFER_ERC20,
      asset: tokenAddress,
      counterparty: destinationAccount.address,
      tokenId: "0",
      amount: "1000000",
    },
  ] as const;
  const delegateActions = actions.map((action) => ({
    ...action,
    tokenId: BigInt(action.tokenId),
    amount: BigInt(action.amount),
  }));
  return eip7702LocalSigningPackageSchema.parse({
    schemaVersion: "safeexit-eip7702-signing-package-v1",
    packageId: "eip7702:package:test",
    jobId: "job:test",
    incidentId: "incident:test",
    planId: "plan:test",
    planHash: plannerPlanHash,
    delegatePlanHash: hashEip7702RescuePlan(delegateActions),
    route: "EIP7702_DELEGATED_RESCUE",
    chainId: 196,
    sourceAddress: sourceAccount.address,
    destinationAddress: destinationAccount.address,
    observedAtBlock: "100",
    expiresAt,
    deadline: Math.floor(Date.parse(expiresAt) / 1_000),
    sourceNonce: 7,
    rescueNonce,
    factoryAddress,
    factoryRuntimeHash,
    delegateAddress,
    actionIds: ["action:native", "action:erc20"],
    actions,
    executionIndexes: [0, 1],
    simulation: {
      resultIds: ["simulation:native", "simulation:erc20"],
      providerId: "xlayer-preflight",
      status: "SUCCEEDED",
      expiresAt: "2026-07-23T10:11:00.000Z",
    },
    policy: {
      sourceSignsLocally: true,
      destinationPaysAllGas: true,
      privateCredentialsAccepted: false,
      authorizationsReturnedToSafeExit: false,
      arbitraryCallsAllowed: false,
      postAuthorizationSimulationRequired: true,
      delegationClearRequired: true,
    },
  });
}

function confirmation(signingPackage: Eip7702LocalSigningPackage) {
  return {
    schemaVersion: "safeexit-buyer-confirmation-v1" as const,
    packageId: signingPackage.packageId,
    planHash: signingPackage.planHash,
    chainId: signingPackage.chainId,
    sourceAddress: signingPackage.sourceAddress,
    destinationAddress: signingPackage.destinationAddress,
    authorizationConfirmed: true as const,
    confirmedAt: now.toISOString(),
  };
}

function delegationCode(address: string): Hex {
  return `0xef0100${address.slice(2).toLowerCase()}` as Hex;
}

function confirmedReceipt(
  hash: Hex,
  status: "CONFIRMED" | "FAILED" = "CONFIRMED",
  confirmations = 64,
): DestinationReceipt {
  return status === "CONFIRMED"
    ? {
        status,
        transactionHashes: [hash],
        blockNumber: "101",
        blockHash,
        confirmations,
        canonical: true,
        observedAt: now.toISOString(),
      }
    : {
        status,
        transactionHashes: [hash],
        blockNumber: "101",
        blockHash,
        confirmations,
        canonical: true,
        observedAt: now.toISOString(),
        failureReason: "execution reverted",
      };
}

function localRuntime(clock: () => Date = () => now): LocalEip7702RescueRuntime {
  return new LocalEip7702RescueRuntime({
    trustedFactory: {
      chainId: 196,
      address: factoryAddress,
      runtimeHash: factoryRuntimeHash,
    },
    clock,
  });
}

class MockDestinationTransport implements Eip7702DestinationTransportPort {
  readonly requests: Eip7702LocalTransactionRequest[] = [];
  readonly signedAuthorizations: SignedAuthorization[] = [];
  readonly inclusionHashes: Hex[] = [];
  readonly finalityHashes: Hex[] = [];
  sourceNonce = 7;
  sourceCode: Hex = "0x";
  delegateDeployed = false;
  factoryHash = factoryRuntimeHash;
  predictedDelegate = delegateAddress;
  failSimulationIndexes = new Set<number>();
  revertIndexes = new Set<number>();
  clearSucceeds = true;
  clearReceiptFailsAfterClearing = false;
  throwOnFirstRescueReceipt = false;
  onFinalityWait?: () => void;
  private rescueCount = 0;

  constructor(
    private readonly payerAddress = destinationAccount.address,
  ) {}

  async getAddress(): Promise<`0x${string}`> {
    return getAddress(this.payerAddress);
  }

  async getChainId(): Promise<number> {
    return 196;
  }

  async inspect(
    signingPackage: Eip7702LocalSigningPackage,
  ): Promise<Eip7702PackageInspection> {
    return {
      sourceNonce: this.sourceNonce,
      sourceCode: this.sourceCode,
      factoryRuntimeHash: this.factoryHash,
      predictedDelegateAddress: getAddress(this.predictedDelegate),
      ...(this.delegateDeployed
        ? {
            delegateState: {
              chainId: signingPackage.chainId,
              sourceAddress: getAddress(signingPackage.sourceAddress),
              destinationAddress: getAddress(signingPackage.destinationAddress),
              deadline: signingPackage.deadline,
              planHash: signingPackage.delegatePlanHash as Hex,
              rescueNonce: signingPackage.rescueNonce as Hex,
            },
          }
        : {}),
    };
  }

  async deployDelegate(): Promise<Hex> {
    this.delegateDeployed = true;
    return deploymentHash;
  }

  async simulate(request: Eip7702LocalTransactionRequest) {
    return this.failSimulationIndexes.has(request.actionIndex ?? -1)
      ? {
          status: "FAILED" as const,
          providerId: "mock",
          simulatedAt: now.toISOString(),
          failureReason: "mock simulation failure",
        }
      : {
          status: "SUCCEEDED" as const,
          providerId: "mock",
          simulatedAt: now.toISOString(),
        };
  }

  async submit(request: Eip7702LocalTransactionRequest): Promise<Hex> {
    this.requests.push(request);
    if (request.authorizationList) {
      this.signedAuthorizations.push(...request.authorizationList);
    }
    if (request.purpose === "CLEAR_DELEGATION") {
      if (this.clearSucceeds) {
        this.sourceNonce = 9;
        this.sourceCode = "0x";
      }
      return clearHash;
    }
    if (request.authorizationList) {
      this.sourceNonce = 8;
      this.sourceCode = delegationCode(delegateAddress);
    }
    this.rescueCount += 1;
    return this.rescueCount === 1 ? rescueHashOne : rescueHashTwo;
  }

  private receiptFor(
    hash: Hex,
    confirmations: number,
  ): DestinationReceipt {
    if (hash === rescueHashOne && this.throwOnFirstRescueReceipt) {
      throw new Error("mock receipt polling failure");
    }
    if (
      hash === clearHash &&
      (!this.clearSucceeds || this.clearReceiptFailsAfterClearing)
    ) {
      return confirmedReceipt(hash, "FAILED", confirmations);
    }
    const request = this.requests.find((candidate, index) => {
      const requestHash = index === 0 ? rescueHashOne : rescueHashTwo;
      return requestHash === hash && candidate.purpose === "RESCUE_ACTION";
    });
    if (request && this.revertIndexes.has(request.actionIndex ?? -1)) {
      return confirmedReceipt(hash, "FAILED", confirmations);
    }
    return confirmedReceipt(hash, "CONFIRMED", confirmations);
  }

  async waitForInclusion(hash: Hex): Promise<DestinationReceipt> {
    this.inclusionHashes.push(hash);
    return this.receiptFor(hash, 1);
  }

  async waitForReceipt(hash: Hex): Promise<DestinationReceipt> {
    this.finalityHashes.push(hash);
    this.onFinalityWait?.();
    return this.receiptFor(hash, 64);
  }
}

async function authorizedRuntime(
  transport: MockDestinationTransport,
  signingPackage = packageValue(),
  runtime = localRuntime(),
) {
  const provisioned = await runtime.provision(
    signingPackage,
    confirmation(signingPackage),
    transport,
  );
  const authorized = await runtime.authorize(
    provisioned,
    new ViemLocalEip7702SourceSigner(sourceAccount),
  );
  return { runtime, authorized };
}

describe("local destination-paid EIP-7702 runtime", () => {
  it("pins the independently verified X Layer factory", () => {
    expect(XLAYER_SAFEEXIT_EIP7702_FACTORY_V2).toEqual({
      chainId: 196,
      address: getAddress("0x115C0340040C68bDc68E1890DA984575E49814e5"),
      runtimeHash:
        "0x0f8beb374fbb87b0a1100b2c25dd649d897a76da1563e8b6cd885a24ac34dc7f",
    });
  });

  it("rejects credential fields and tampered delegated plans", () => {
    const signingPackage = packageValue();
    expect(eip7702LocalSigningPackageSchema.safeParse({
      ...signingPackage,
      privateKey: "0xsecret",
    }).success).toBe(false);
    expect(eip7702LocalSigningPackageSchema.safeParse({
      ...signingPackage,
      delegatePlanHash: `0x${"99".repeat(32)}`,
    }).success).toBe(false);
    expect(eip7702LocalSigningPackageSchema.safeParse({
      ...signingPackage,
      actions: signingPackage.actions.map((action, index) =>
        index === 0 ? { ...action, amount: "1" } : action),
    }).success).toBe(false);
    expect(eip7702LocalSigningPackageSchema.safeParse({
      ...signingPackage,
      executionIndexes: [0],
      simulation: {
        ...signingPackage.simulation,
        resultIds: [signingPackage.simulation.resultIds[0]],
      },
    }).success).toBe(false);
  });

  it("deploys, rescues each action, and clears through a separate gas payer", async () => {
    const transport = new MockDestinationTransport(otherAccount.address);
    const { runtime, authorized } = await authorizedRuntime(transport);
    const result = await runtime.execute(authorized);

    expect(result).toMatchObject({
      status: "COMPLETED",
      sourcePaidGas: false,
      destinationAddress: destinationAccount.address,
      payerAddress: otherAccount.address,
      deploymentHashes: [deploymentHash],
      rescueTransactionHashes: [rescueHashOne, rescueHashTwo],
      clearTransactionHash: clearHash,
    });
    expect(transport.requests).toHaveLength(3);
    expect(transport.requests.every(
      (request) => request.from.toLowerCase() === otherAccount.address.toLowerCase(),
    )).toBe(true);
    expect(transport.requests[0]?.authorizationList).toHaveLength(1);
    expect(transport.requests[1]?.authorizationList).toBeUndefined();
    expect(transport.requests[2]).toMatchObject({
      purpose: "CLEAR_DELEGATION",
      to: sourceAccount.address,
      data: "0x",
    });
    expect(transport.inclusionHashes).toEqual([
      deploymentHash,
      rescueHashOne,
      rescueHashTwo,
    ]);
    expect(transport.finalityHashes).toEqual([clearHash]);
    expect(transport.sourceCode).toBe("0x");
    expect(transport.sourceNonce).toBe(9);
  });

  it("finishes every action before waiting for canonical finality", async () => {
    let currentTime = now;
    const runtime = localRuntime(() => currentTime);
    const transport = new MockDestinationTransport(otherAccount.address);
    transport.onFinalityWait = () => {
      currentTime = new Date(Date.parse(expiresAt) + 60_000);
    };
    const { authorized } = await authorizedRuntime(
      transport,
      packageValue(),
      runtime,
    );

    const result = await runtime.execute(authorized);

    expect(result.status).toBe("COMPLETED");
    expect(result.outcomes).toHaveLength(2);
    expect(transport.inclusionHashes).toEqual([
      deploymentHash,
      rescueHashOne,
      rescueHashTwo,
    ]);
    expect(transport.finalityHashes).toEqual([clearHash]);
  });

  it("skips a failed simulation, rescues the remaining asset, and still clears", async () => {
    const transport = new MockDestinationTransport();
    transport.failSimulationIndexes.add(0);
    const { runtime, authorized } = await authorizedRuntime(transport);
    const result = await runtime.execute(authorized);

    expect(result.status).toBe("PARTIAL");
    expect(result.outcomes.map((outcome) => outcome.status)).toEqual([
      "SIMULATION_FAILED",
      "COMPLETED",
    ]);
    expect(transport.requests[0]?.actionIndex).toBe(1);
    expect(transport.requests[0]?.authorizationList).toHaveLength(1);
    expect(transport.requests.at(-1)?.purpose).toBe("CLEAR_DELEGATION");
  });

  it("continues after an isolated rescue revert and clears the delegation", async () => {
    const transport = new MockDestinationTransport();
    transport.revertIndexes.add(0);
    const { runtime, authorized } = await authorizedRuntime(transport);
    const result = await runtime.execute(authorized);

    expect(result.status).toBe("PARTIAL");
    expect(result.outcomes.map((outcome) => outcome.status)).toEqual([
      "TRANSACTION_REVERTED",
      "COMPLETED",
    ]);
    expect(transport.sourceCode).toBe("0x");
  });

  it("submits the clearing fallback when receipt polling fails after delegation", async () => {
    const transport = new MockDestinationTransport();
    transport.throwOnFirstRescueReceipt = true;
    const { runtime, authorized } = await authorizedRuntime(transport);

    await expect(runtime.execute(authorized)).rejects.toThrow(
      "mock receipt polling failure",
    );
    expect(transport.requests.map((request) => request.purpose)).toEqual([
      "RESCUE_ACTION",
      "CLEAR_DELEGATION",
    ]);
    expect(transport.sourceCode).toBe("0x");
    expect(transport.sourceNonce).toBe(9);
  });

  it("accepts canonical clearing even when the receipt provider reports failure", async () => {
    const transport = new MockDestinationTransport();
    transport.clearReceiptFailsAfterClearing = true;
    const { runtime, authorized } = await authorizedRuntime(transport);

    const result = await runtime.execute(authorized);

    expect(result.clearTransactionHash).toBe(clearHash);
    expect(transport.sourceCode).toBe("0x");
    expect(transport.sourceNonce).toBe(9);
  });

  it("fails before signing when the source nonce or factory changes", async () => {
    const stale = new MockDestinationTransport();
    stale.sourceNonce = 8;
    const signingPackage = packageValue();
    await expect(localRuntime().provision(
      signingPackage,
      confirmation(signingPackage),
      stale,
    )).rejects.toMatchObject({ code: "STALE_SOURCE_NONCE" });

    const wrongFactory = new MockDestinationTransport();
    wrongFactory.factoryHash = `0x${"99".repeat(32)}`;
    await expect(localRuntime().provision(
      signingPackage,
      confirmation(signingPackage),
      wrongFactory,
    )).rejects.toMatchObject({ code: "FACTORY_MISMATCH" });

    const substitutedPackage = eip7702LocalSigningPackageSchema.parse({
      ...signingPackage,
      factoryAddress: "0x9000000000000000000000000000000000000009",
      factoryRuntimeHash: `0x${"99".repeat(32)}`,
    });
    await expect(localRuntime().provision(
      substitutedPackage,
      confirmation(substitutedPackage),
      new MockDestinationTransport(),
    )).rejects.toMatchObject({ code: "FACTORY_MISMATCH" });
  });

  it("rejects a different local source signer and a failed clear", async () => {
    const signingPackage = packageValue();
    const signerTransport = new MockDestinationTransport();
    const runtime = localRuntime();
    const provisioned = await runtime.provision(
      signingPackage,
      confirmation(signingPackage),
      signerTransport,
    );
    await expect(runtime.authorize(
      provisioned,
      new ViemLocalEip7702SourceSigner(otherAccount),
    )).rejects.toMatchObject({ code: "SOURCE_MISMATCH" });

    const clearTransport = new MockDestinationTransport();
    clearTransport.clearSucceeds = false;
    const prepared = await authorizedRuntime(clearTransport);
    await expect(prepared.runtime.execute(prepared.authorized)).rejects.toEqual(
      expect.objectContaining<Eip7702RuntimeError>({
        code: "DELEGATION_NOT_CLEARED",
      }),
    );
  });

  it("preserves the preceding rescue failure when the clearing fallback also fails", async () => {
    const transport = new MockDestinationTransport();
    transport.throwOnFirstRescueReceipt = true;
    transport.clearSucceeds = false;
    const prepared = await authorizedRuntime(transport);

    await expect(prepared.runtime.execute(prepared.authorized)).rejects.toEqual(
      expect.objectContaining<Eip7702RuntimeError>({
        code: "DELEGATION_NOT_CLEARED",
        message:
          "execution reverted; preceding rescue failure: mock receipt polling failure",
      }),
    );
  });
});
