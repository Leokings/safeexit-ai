import { describe, expect, it } from "vitest";
import { privateKeyToAccount } from "viem/accounts";

import {
  SIGNING_PACKAGE_EIP712_TYPES,
  signingPackageSchema,
  type SigningPackage,
} from "@safeexit/agent-service";
import {
  getConfiguredPermitSettlementAddress,
  PERMIT_KIND_DAI,
  PERMIT_KIND_ERC2612,
  PERMIT_SETTLEMENT_NAME,
  PERMIT_SETTLEMENT_VERSION,
} from "@safeexit/adapters";

import {
  BuyerRescueRuntime,
  BuyerRuntimeError,
  buyerConfirmationSchema,
  type AtomicSettlementSimulatorPort,
  type DestinationSettlementWalletPort,
  type LocalSourceSignerPort,
  type SettlementBatch,
  type SourceSigningRequest,
} from "../src";

const sourceAccount = privateKeyToAccount(`0x${"11".repeat(32)}`);
const wrongAccount = privateKeyToAccount(`0x${"22".repeat(32)}`);
const destination = "0x3333333333333333333333333333333333333333" as const;
const token = "0x4444444444444444444444444444444444444444" as const;
const collection = "0x5555555555555555555555555555555555555555" as const;
const settlementContract = getConfiguredPermitSettlementAddress(196)!;
const planHash = `0x${"66".repeat(32)}`;
const txHash = `0x${"77".repeat(32)}`;
const now = new Date("2026-07-13T10:00:00.000Z");
const expiresAt = "2026-07-13T10:04:00.000Z";
const deadline = String(Math.floor(Date.parse(expiresAt) / 1_000));

const policy = {
  sourceSignsLocally: true,
  destinationPaysSettlement: true,
  privateCredentialsAccepted: false,
  signaturesReturnedToSafeExit: false,
  arbitraryCallsAllowed: false,
  postSignatureSimulationRequired: true,
} as const;

const common = {
  schemaVersion: "safeexit-signing-package-v1",
  packageId: "package:test",
  jobId: "job:test",
  incidentId: "incident:test",
  planId: "plan:test",
  planHash,
  actionId: "action:test",
  chainId: 196,
  sourceAddress: sourceAccount.address,
  destinationAddress: destination,
  observedAtBlock: "100",
  expiresAt,
  simulation: {
    resultId: "simulation:test",
    providerId: "plan-simulator",
    status: "SUCCEEDED",
    expiresAt: "2026-07-13T10:05:00.000Z",
  },
  policy,
} as const;

const domain = (verifyingContract: `0x${string}`) => ({
  name: "Rescue Asset",
  version: "1",
  chainId: 196,
  verifyingContract,
});

const requestCommon = {
  signer: sourceAccount.address,
  method: "EIP712",
  rpcMethod: "eth_signTypedData_v4",
} as const;

function erc20RescueRequest(permitNonce: string, permitKind: 1 | 2) {
  return {
    ...requestCommon,
    id: "source-rescue-authorization" as const,
    typedData: {
      primaryType: "ERC20Rescue" as const,
      types: {
        EIP712Domain: [...SIGNING_PACKAGE_EIP712_TYPES.EIP712Domain],
        ERC20Rescue: [...SIGNING_PACKAGE_EIP712_TYPES.ERC20Rescue],
      },
      domain: {
        name: PERMIT_SETTLEMENT_NAME,
        version: PERMIT_SETTLEMENT_VERSION,
        chainId: 196,
        verifyingContract: settlementContract,
      },
      message: {
        token,
        owner: sourceAccount.address,
        destination,
        amount: "100",
        permitNonce,
        deadline,
        rescueNonce: `0x${"99".repeat(32)}`,
        permitKind,
      },
    },
  };
}

function erc721RescueRequest() {
  return {
    ...requestCommon,
    id: "source-rescue-authorization" as const,
    typedData: {
      primaryType: "ERC721Rescue" as const,
      types: {
        EIP712Domain: [...SIGNING_PACKAGE_EIP712_TYPES.EIP712Domain],
        ERC721Rescue: [...SIGNING_PACKAGE_EIP712_TYPES.ERC721Rescue],
      },
      domain: {
        name: PERMIT_SETTLEMENT_NAME,
        version: PERMIT_SETTLEMENT_VERSION,
        chainId: 196,
        verifyingContract: settlementContract,
      },
      message: {
        collection,
        owner: sourceAccount.address,
        destination,
        tokenId: "12",
        permitNonce: "2",
        deadline,
        rescueNonce: `0x${"aa".repeat(32)}`,
      },
    },
  };
}

function packageFor(route: SigningPackage["route"]): SigningPackage {
  if (route === "ERC3009_RECEIVE_WITH_AUTHORIZATION") {
    return signingPackageSchema.parse({
      ...common,
      route,
      tokenAddress: token,
      amount: "100",
      sourceSigningRequests: [{
        ...requestCommon,
        id: "source-transfer-authorization",
        typedData: {
          primaryType: "ReceiveWithAuthorization",
          types: {
            EIP712Domain: [...SIGNING_PACKAGE_EIP712_TYPES.EIP712Domain],
            ReceiveWithAuthorization: [
              ...SIGNING_PACKAGE_EIP712_TYPES.ReceiveWithAuthorization,
            ],
          },
          domain: domain(token),
          message: {
            from: sourceAccount.address,
            to: destination,
            value: "100",
            validAfter: String(Math.floor(now.getTime() / 1_000) - 30),
            validBefore: deadline,
            nonce: `0x${"88".repeat(32)}`,
          },
        },
      }],
      destinationSettlement: {
        executor: destination,
        payer: "DESTINATION",
        assembly: "BUYER_LOCAL_RUNTIME",
        atomicRequired: false,
        operations: ["RECEIVE_WITH_AUTHORIZATION"],
      },
    });
  }
  if (route === "ERC2612_PERMIT_SETTLEMENT") {
    return signingPackageSchema.parse({
      ...common,
      route,
      tokenAddress: token,
      settlementContract,
      amount: "100",
      sourceSigningRequests: [
        {
          ...requestCommon,
          id: "source-permit",
          typedData: {
            primaryType: "Permit",
            types: {
              EIP712Domain: [...SIGNING_PACKAGE_EIP712_TYPES.EIP712Domain],
              Permit: [...SIGNING_PACKAGE_EIP712_TYPES.ERC2612Permit],
            },
            domain: domain(token),
            message: {
              owner: sourceAccount.address,
              spender: settlementContract,
              value: "100",
              nonce: "4",
              deadline,
            },
          },
        },
        erc20RescueRequest("4", PERMIT_KIND_ERC2612),
      ],
      destinationSettlement: {
        executor: destination,
        payer: "DESTINATION",
        assembly: "BUYER_LOCAL_RUNTIME",
        atomicRequired: false,
        operations: ["SETTLE_ERC2612"],
      },
    });
  }
  if (route === "DAI_PERMIT_SETTLEMENT") {
    const permit = (id: "source-allow-permit" | "source-revoke-permit", nonce: string, allowed: boolean) => ({
      ...requestCommon,
      id,
      typedData: {
        primaryType: "Permit" as const,
        types: {
          EIP712Domain: [...SIGNING_PACKAGE_EIP712_TYPES.EIP712Domain],
          Permit: [...SIGNING_PACKAGE_EIP712_TYPES.DaiPermit],
        },
        domain: domain(token),
        message: {
          holder: sourceAccount.address,
          spender: settlementContract,
          nonce,
          expiry: deadline,
          allowed,
        },
      },
    });
    return signingPackageSchema.parse({
      ...common,
      route,
      tokenAddress: token,
      settlementContract,
      amount: "100",
      sourceSigningRequests: [
        permit("source-allow-permit", "7", true),
        permit("source-revoke-permit", "8", false),
        erc20RescueRequest("7", PERMIT_KIND_DAI),
      ],
      destinationSettlement: {
        executor: destination,
        payer: "DESTINATION",
        assembly: "BUYER_LOCAL_RUNTIME",
        atomicRequired: false,
        operations: ["SETTLE_DAI_PERMIT"],
      },
    });
  }
  return signingPackageSchema.parse({
    ...common,
    route,
    collectionAddress: collection,
    settlementContract,
    tokenId: "12",
    sourceSigningRequests: [
      {
        ...requestCommon,
        id: "source-nft-permit",
        typedData: {
          primaryType: "Permit",
          types: {
            EIP712Domain: [...SIGNING_PACKAGE_EIP712_TYPES.EIP712Domain],
            Permit: [...SIGNING_PACKAGE_EIP712_TYPES.ERC4494Permit],
          },
          domain: domain(collection),
          message: {
            spender: settlementContract,
            tokenId: "12",
            nonce: "2",
            deadline,
          },
        },
      },
      erc721RescueRequest(),
    ],
    destinationSettlement: {
      executor: destination,
      payer: "DESTINATION",
      assembly: "BUYER_LOCAL_RUNTIME",
      atomicRequired: false,
      operations: ["SETTLE_ERC4494"],
    },
  });
}

function confirmation(signingPackage: SigningPackage) {
  return buyerConfirmationSchema.parse({
    schemaVersion: "safeexit-buyer-confirmation-v1",
    packageId: signingPackage.packageId,
    planHash: signingPackage.planHash,
    chainId: signingPackage.chainId,
    sourceAddress: signingPackage.sourceAddress,
    destinationAddress: signingPackage.destinationAddress,
    authorizationConfirmed: true,
    confirmedAt: now.toISOString(),
  });
}

function signer(account = sourceAccount): LocalSourceSignerPort {
  return {
    getAddress: async () => account.address,
    signTypedData: async (request: SourceSigningRequest) => {
      const types = { ...request.typedData.types } as Record<
        string,
        readonly { name: string; type: string }[]
      >;
      delete types.EIP712Domain;
      return account.signTypedData({
        domain: request.typedData.domain,
        types,
        primaryType: request.typedData.primaryType,
        message: request.typedData.message,
      });
    },
  };
}

function successfulSimulator(
  captured: SettlementBatch[],
): AtomicSettlementSimulatorPort {
  return {
    simulate: async (batch) => {
      captured.push(batch);
      return {
        status: "SUCCEEDED",
        providerId: "eth-simulate-v1-test",
        simulatedAt: now.toISOString(),
        callCount: batch.calls.length,
      };
    },
  };
}

function destinationWallet(
  submitted: SettlementBatch[],
  options: { address?: `0x${string}`; chainId?: number; atomic?: boolean } = {},
): DestinationSettlementWalletPort {
  return {
    getAddress: async () => options.address ?? destination,
    getChainId: async () => options.chainId ?? 196,
    supportsAtomicBatch: async () => options.atomic ?? true,
    submit: async (batch) => {
      submitted.push(batch);
      return { submissionId: "submission:test" };
    },
    waitForReceipt: async () => ({
      status: "CONFIRMED",
      transactionHashes: [txHash],
      observedAt: "2026-07-13T10:01:00.000Z",
    }),
  };
}

describe("buyer-local rescue runtime", () => {
  const routes: Array<[SigningPackage["route"], number]> = [
    ["ERC3009_RECEIVE_WITH_AUTHORIZATION", 1],
    ["ERC2612_PERMIT_SETTLEMENT", 1],
    ["DAI_PERMIT_SETTLEMENT", 1],
    ["ERC4494_PERMIT_SETTLEMENT", 1],
  ];

  it.each(routes)("authorizes and executes %s with %i exact calls", async (route, callCount) => {
    const signingPackage = packageFor(route);
    const runtime = new BuyerRescueRuntime(() => now);
    const handle = await runtime.authorize(signingPackage, confirmation(signingPackage), signer());
    const simulated: SettlementBatch[] = [];
    const submitted: SettlementBatch[] = [];
    const report = await runtime.execute(
      handle,
      successfulSimulator(simulated),
      destinationWallet(submitted),
    );

    expect(handle.summary.operationCount).toBe(callCount);
    expect(simulated[0]?.calls).toHaveLength(callCount);
    expect(submitted[0]?.calls).toEqual(simulated[0]?.calls);
    expect(submitted[0]?.calls.every((call) => call.to.toLowerCase() ===
      (route === "ERC3009_RECEIVE_WITH_AUTHORIZATION"
        ? token
        : settlementContract).toLowerCase())).toBe(true);
    expect(JSON.stringify(report)).not.toMatch(/signature|calldata|private/i);
    expect(report.transactionHashes).toEqual([txHash]);
  });

  it("rejects a source signer mismatch before requesting a signature", async () => {
    const signingPackage = packageFor("ERC2612_PERMIT_SETTLEMENT");
    const runtime = new BuyerRescueRuntime(() => now);

    await expect(runtime.authorize(
      signingPackage,
      confirmation(signingPackage),
      signer(wrongAccount),
    )).rejects.toMatchObject({ code: "SOURCE_MISMATCH" });
  });

  it("rejects a valid signature from the wrong source", async () => {
    const signingPackage = packageFor("ERC2612_PERMIT_SETTLEMENT");
    const wrongSignatureSigner: LocalSourceSignerPort = {
      getAddress: async () => sourceAccount.address,
      signTypedData: signer(wrongAccount).signTypedData,
    };

    await expect(new BuyerRescueRuntime(() => now).authorize(
      signingPackage,
      confirmation(signingPackage),
      wrongSignatureSigner,
    )).rejects.toMatchObject({ code: "INVALID_SIGNATURE" });
  });

  it("rejects destination substitution and wrong-chain execution", async () => {
    const signingPackage = packageFor("ERC2612_PERMIT_SETTLEMENT");
    const runtime = new BuyerRescueRuntime(() => now);
    const first = await runtime.authorize(signingPackage, confirmation(signingPackage), signer());
    await expect(runtime.execute(
      first,
      successfulSimulator([]),
      destinationWallet([], { address: wrongAccount.address }),
    )).rejects.toMatchObject({ code: "DESTINATION_MISMATCH" });

    const second = await runtime.authorize(signingPackage, confirmation(signingPackage), signer());
    await expect(runtime.execute(
      second,
      successfulSimulator([]),
      destinationWallet([], { chainId: 1 }),
    )).rejects.toMatchObject({ code: "CHAIN_MISMATCH" });
  });

  it("does not require wallet batching and still requires post-signature simulation", async () => {
    const signingPackage = packageFor("DAI_PERMIT_SETTLEMENT");
    const runtime = new BuyerRescueRuntime(() => now);
    const noAtomic = await runtime.authorize(signingPackage, confirmation(signingPackage), signer());
    await expect(runtime.execute(
      noAtomic,
      successfulSimulator([]),
      destinationWallet([], { atomic: false }),
    )).resolves.toMatchObject({ status: "COMPLETED" });

    const failedSimulation = await runtime.authorize(
      signingPackage,
      confirmation(signingPackage),
      signer(),
    );
    const submitted: SettlementBatch[] = [];
    await expect(runtime.execute(
      failedSimulation,
      {
        simulate: async (batch) => ({
          status: "FAILED",
          providerId: "test",
          simulatedAt: now.toISOString(),
          callCount: batch.calls.length,
          failureReason: "Permit nonce changed",
        }),
      },
      destinationWallet(submitted),
    )).rejects.toMatchObject({ code: "SIMULATION_FAILED" });
    expect(submitted).toHaveLength(0);
  });

  it("rechecks destination account and chain after simulation", async () => {
    const signingPackage = packageFor("ERC2612_PERMIT_SETTLEMENT");
    const runtime = new BuyerRescueRuntime(() => now);
    const handle = await runtime.authorize(
      signingPackage,
      confirmation(signingPackage),
      signer(),
    );
    let activeAddress = destination;
    let submitted = false;
    const wallet: DestinationSettlementWalletPort = {
      getAddress: async () => activeAddress,
      getChainId: async () => 196,
      supportsAtomicBatch: async () => true,
      submit: async () => {
        submitted = true;
        return { submissionId: "submission:test" };
      },
      waitForReceipt: async () => ({
        status: "CONFIRMED",
        transactionHashes: [txHash],
        observedAt: now.toISOString(),
      }),
    };
    const simulator: AtomicSettlementSimulatorPort = {
      simulate: async (batch) => {
        activeAddress = wrongAccount.address;
        return {
          status: "SUCCEEDED",
          providerId: "test",
          simulatedAt: now.toISOString(),
          callCount: batch.calls.length,
        };
      },
    };

    await expect(runtime.execute(handle, simulator, wallet)).rejects.toMatchObject({
      code: "DESTINATION_MISMATCH",
    });
    expect(submitted).toBe(false);
  });

  it("keeps authorizations process-local and one-use", async () => {
    const signingPackage = packageFor("ERC3009_RECEIVE_WITH_AUTHORIZATION");
    const runtime = new BuyerRescueRuntime(() => now);
    const handle = await runtime.authorize(signingPackage, confirmation(signingPackage), signer());
    const serialized = JSON.parse(JSON.stringify(handle)) as typeof handle;

    await expect(runtime.execute(
      serialized,
      successfulSimulator([]),
      destinationWallet([]),
    )).rejects.toMatchObject({ code: "INVALID_HANDLE" });

    await runtime.execute(handle, successfulSimulator([]), destinationWallet([]));
    await expect(runtime.execute(
      handle,
      successfulSimulator([]),
      destinationWallet([]),
    )).rejects.toMatchObject({ code: "INVALID_HANDLE" });
  });

  it("rejects expired packages before source signing", async () => {
    const signingPackage = packageFor("ERC3009_RECEIVE_WITH_AUTHORIZATION");
    const runtime = new BuyerRescueRuntime(() => new Date(expiresAt));

    await expect(runtime.authorize(
      signingPackage,
      confirmation(signingPackage),
      signer(),
    )).rejects.toEqual(expect.objectContaining<Partial<BuyerRuntimeError>>({
      code: "PACKAGE_EXPIRED",
    }));
  });

  it("rejects an ERC-3009 authorization whose validity window has not opened", async () => {
    const base = packageFor("ERC3009_RECEIVE_WITH_AUTHORIZATION");
    const request = base.sourceSigningRequests[0];
    const signingPackage = signingPackageSchema.parse({
      ...base,
      sourceSigningRequests: [{
        ...request,
        typedData: {
          ...request.typedData,
          message: {
            ...request.typedData.message,
            validAfter: String(Math.floor(now.getTime() / 1_000) + 60),
          },
        },
      }],
    });
    const runtime = new BuyerRescueRuntime(() => now);

    await expect(runtime.authorize(
      signingPackage,
      confirmation(signingPackage),
      signer(),
    )).rejects.toMatchObject({ code: "PACKAGE_EXPIRED" });
  });
});
