import { describe, expect, it } from "vitest";

import { evmAddressSchema, type Incident, type RescuePlan, type WalletScan } from "@safeexit/shared";
import {
  getConfiguredPermitSettlementAddress,
  PERMIT_KIND_ERC2612,
  PERMIT_SETTLEMENT_NAME,
  PERMIT_SETTLEMENT_VERSION,
} from "@safeexit/adapters";

import {
  AgentIncidentService,
  InMemoryAgentServiceJobStore,
  OKX_AI_INTEGRATION_BOUNDARIES,
  SIGNING_PACKAGE_EIP712_TYPES,
  SafeExitDashboardLocator,
  agentServiceJobSchema,
  conceptualA2ARequestSchema,
  toConceptualA2AResponse,
  type AgentSimulationReport,
  type BuyerExecutionReport,
  type RescueMonitorObservation,
  type SigningPackage,
} from "../src";

const source = evmAddressSchema.parse("0x70997970C51812dc3A010C7d01b50e0d17dc79C8");
const destination = evmAddressSchema.parse("0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65");
const otherDestination = evmAddressSchema.parse("0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc");
const token = evmAddressSchema.parse("0x5FbDB2315678afecb367f032d93F642f64180aa3");
const collection = evmAddressSchema.parse("0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512");
const settlementContract = getConfiguredPermitSettlementAddress(196)!;
const planHash = `0x${"3".repeat(64)}`;
const txHash = `0x${"a".repeat(64)}`;
const now = "2026-07-12T10:00:00.000Z";

const incident: Incident = {
  id: "incident:test",
  chainId: 196,
  sourceAddress: source,
  destinationAddress: destination,
  status: "RECEIVED",
  ownershipAttestation: {
    accepted: true,
    statementVersion: "1",
    attestedAt: now,
  },
  createdAt: now,
  updatedAt: now,
};

const scan: WalletScan = {
  id: "scan:test",
  incidentId: incident.id,
  chainId: incident.chainId,
  address: source,
  status: "COMPLETE",
  providerId: "test-scanner",
  observedAtBlock: "12",
  observedAt: now,
  assets: [
    {
      id: "asset:test",
      chainId: incident.chainId,
      ownerAddress: source,
      supportStatus: "DETECTED",
      observedAtBlock: "12",
      discoverySource: "test-manifest",
      confidence: 1,
      assetType: "ERC20",
      contractAddress: token,
      name: "Test Token",
      symbol: "TEST",
      decimals: 18,
      balance: "100",
    },
  ],
  approvals: [],
  warnings: [],
};

const plan: RescuePlan = {
  id: "plan:test",
  incidentId: incident.id,
  version: 1,
  policyVersion: "test-1",
  chainId: incident.chainId,
  sourceAddress: source,
  destinationAddress: destination,
  observedAtBlock: scan.observedAtBlock,
  status: "READY",
  actions: [
    {
      id: "action:transfer",
      chainId: incident.chainId,
      sourceAddress: source,
      dependencies: [],
      evidenceIds: ["asset:test"],
      expectedEffects: [
        {
          effectType: "ASSET_TRANSFERRED",
          assetId: "asset:test",
          description: "Move the test token to the confirmed destination.",
        },
      ],
      riskLevel: "MEDIUM",
      supportStatus: "SUPPORTED",
      simulationStatus: "PASSED",
      actionType: "TRANSFER_ERC20",
      parameters: {
        tokenAddress: token,
        recipient: destination,
        amount: "100",
      },
    },
  ],
  omissions: [],
  integrityHash: planHash,
  createdAt: now,
};

function simulationReport(status: AgentSimulationReport["status"]): AgentSimulationReport {
  const succeeded = status !== "FAILED";
  return {
    status,
    providerId: "test-simulator",
    results: [
      {
        id: "simulation:test",
        planId: plan.id,
        actionId: "action:transfer",
        providerId: "test-simulator",
        status: succeeded ? "SUCCEEDED" : "REVERTED",
        planHash,
        observedAtBlock: plan.observedAtBlock,
        expectedEffects: plan.actions[0]?.expectedEffects ?? [],
        assetChanges: [],
        warnings: [],
        ...(!succeeded ? { failureReason: "Test revert" } : {}),
        simulatedAt: now,
        expiresAt: "2026-07-12T10:05:00.000Z",
      },
    ],
    executableActionIds: succeeded ? ["action:transfer"] : [],
    excludedActionIds: succeeded ? [] : ["action:transfer"],
  };
}

function signingPackage(overrides: Partial<SigningPackage> = {}): SigningPackage {
  return {
    schemaVersion: "safeexit-signing-package-v1",
    packageId: "signing-package:test",
    jobId: "job:test",
    incidentId: incident.id,
    planId: plan.id,
    planHash,
    actionId: "action:transfer",
    route: "ERC2612_PERMIT_SETTLEMENT",
    chainId: incident.chainId,
    sourceAddress: source,
    destinationAddress: destination,
    observedAtBlock: plan.observedAtBlock,
    expiresAt: "2026-07-12T10:04:00.000Z",
    tokenAddress: token,
    settlementContract,
    amount: "100",
    sourceSigningRequests: [
      {
        id: "source-permit",
        signer: source,
        method: "EIP712",
        rpcMethod: "eth_signTypedData_v4",
        typedData: {
          primaryType: "Permit",
          types: {
            EIP712Domain: [...SIGNING_PACKAGE_EIP712_TYPES.EIP712Domain],
            Permit: [...SIGNING_PACKAGE_EIP712_TYPES.ERC2612Permit],
          },
          domain: {
            name: "Test Token",
            version: "1",
            chainId: incident.chainId,
            verifyingContract: token,
          },
          message: {
            owner: source,
            spender: settlementContract,
            value: "100",
            nonce: "0",
            deadline: "1783850640",
          },
        },
      },
      {
        id: "source-rescue-authorization",
        signer: source,
        method: "EIP712",
        rpcMethod: "eth_signTypedData_v4",
        typedData: {
          primaryType: "ERC20Rescue",
          types: {
            EIP712Domain: [...SIGNING_PACKAGE_EIP712_TYPES.EIP712Domain],
            ERC20Rescue: [...SIGNING_PACKAGE_EIP712_TYPES.ERC20Rescue],
          },
          domain: {
            name: PERMIT_SETTLEMENT_NAME,
            version: PERMIT_SETTLEMENT_VERSION,
            chainId: incident.chainId,
            verifyingContract: settlementContract,
          },
          message: {
            token,
            owner: source,
            destination,
            amount: "100",
            permitNonce: "0",
            deadline: "1783850640",
            rescueNonce: `0x${"9".repeat(64)}`,
            permitKind: PERMIT_KIND_ERC2612,
          },
        },
      },
    ],
    destinationSettlement: {
      executor: destination,
      payer: "DESTINATION",
      assembly: "BUYER_LOCAL_RUNTIME",
      atomicRequired: false,
      operations: ["SETTLE_ERC2612"],
    },
    simulation: {
      resultId: "simulation:test",
      providerId: "test-simulator",
      status: "SUCCEEDED",
      expiresAt: "2026-07-12T10:05:00.000Z",
    },
    policy: {
      sourceSignsLocally: true,
      destinationPaysSettlement: true,
      privateCredentialsAccepted: false,
      signaturesReturnedToSafeExit: false,
      arbitraryCallsAllowed: false,
      postSignatureSimulationRequired: true,
    },
    ...overrides,
  } as SigningPackage;
}

function nftSigningPackage(): SigningPackage {
  return {
    schemaVersion: "safeexit-signing-package-v1",
    packageId: "signing-package:nft",
    jobId: "job:test",
    incidentId: incident.id,
    planId: plan.id,
    planHash,
    actionId: "action:nft",
    route: "ERC4494_PERMIT_SETTLEMENT",
    chainId: incident.chainId,
    sourceAddress: source,
    destinationAddress: destination,
    observedAtBlock: plan.observedAtBlock,
    expiresAt: "2026-07-12T10:04:00.000Z",
    collectionAddress: collection,
    settlementContract,
    tokenId: "42",
    sourceSigningRequests: [
      {
        id: "source-nft-permit",
        signer: source,
        method: "EIP712",
        rpcMethod: "eth_signTypedData_v4",
        typedData: {
          primaryType: "Permit",
          types: {
            EIP712Domain: [...SIGNING_PACKAGE_EIP712_TYPES.EIP712Domain],
            Permit: [...SIGNING_PACKAGE_EIP712_TYPES.ERC4494Permit],
          },
          domain: {
            name: "Rescue NFT",
            version: "1",
            chainId: incident.chainId,
            verifyingContract: collection,
          },
          message: {
            spender: settlementContract,
            tokenId: "42",
            nonce: "0",
            deadline: "1783850640",
          },
        },
      },
      {
        id: "source-rescue-authorization",
        signer: source,
        method: "EIP712",
        rpcMethod: "eth_signTypedData_v4",
        typedData: {
          primaryType: "ERC721Rescue",
          types: {
            EIP712Domain: [...SIGNING_PACKAGE_EIP712_TYPES.EIP712Domain],
            ERC721Rescue: [...SIGNING_PACKAGE_EIP712_TYPES.ERC721Rescue],
          },
          domain: {
            name: PERMIT_SETTLEMENT_NAME,
            version: PERMIT_SETTLEMENT_VERSION,
            chainId: incident.chainId,
            verifyingContract: settlementContract,
          },
          message: {
            collection,
            owner: source,
            destination,
            tokenId: "42",
            permitNonce: "0",
            deadline: "1783850640",
            rescueNonce: `0x${"8".repeat(64)}`,
          },
        },
      },
    ],
    destinationSettlement: {
      executor: destination,
      payer: "DESTINATION",
      assembly: "BUYER_LOCAL_RUNTIME",
      atomicRequired: false,
      operations: ["SETTLE_ERC4494"],
    },
    simulation: {
      resultId: "simulation:nft",
      providerId: "test-simulator",
      status: "SUCCEEDED",
      expiresAt: "2026-07-12T10:05:00.000Z",
    },
    policy: {
      sourceSignsLocally: true,
      destinationPaysSettlement: true,
      privateCredentialsAccepted: false,
      signaturesReturnedToSafeExit: false,
      arbitraryCallsAllowed: false,
      postSignatureSimulationRequired: true,
    },
  };
}

function observation(
  phase: RescueMonitorObservation["phase"],
): RescueMonitorObservation {
  const terminal = phase === "COMPLETED" || phase === "PARTIAL";
  return {
    phase,
    completedActionIds: phase === "COMPLETED" || phase === "PARTIAL" ? ["action:transfer"] : [],
    failedActionIds: phase === "PARTIAL" ? ["action:transfer"] : [],
    transactionHashes: terminal ? [txHash] : [],
    observedAt: now,
  };
}

function buyerReport(): BuyerExecutionReport {
  return {
    schemaVersion: "safeexit-buyer-report-v1",
    packageId: "signing-package:test",
    jobId: "job:test",
    incidentId: incident.id,
    planId: plan.id,
    planHash,
    actionId: "action:transfer",
    route: "ERC2612_PERMIT_SETTLEMENT",
    chainId: incident.chainId,
    sourceAddress: source,
    destinationAddress: destination,
    status: "COMPLETED",
    simulationProviderId: "buyer-local-eth-simulate-v1",
    simulatedAt: now,
    transactionHashes: [txHash],
    completedAt: now,
  };
}

type ServiceOptions = {
  analyzerError?: Error;
  simulationStatus?: AgentSimulationReport["status"];
  observations?: RescueMonitorObservation[];
  signingPackage?: SigningPackage;
  signingPackages?: SigningPackage[];
  plan?: RescuePlan;
  simulation?: AgentSimulationReport;
};

function createService(options: ServiceOptions = {}) {
  const pendingObservations = [...(options.observations ?? [observation("WAITING_FOR_USER")])];
  const store = new InMemoryAgentServiceJobStore();
  const service = new AgentIncidentService({
    store,
    analyzer: {
      analyse: async () => {
        if (options.analyzerError) {
          throw options.analyzerError;
        }
        return scan;
      },
    },
    planner: { generate: async () => options.plan ?? plan },
    simulator: {
      simulate: async () => options.simulation ?? simulationReport(options.simulationStatus ?? "SUCCEEDED"),
    },
    dashboard: new SafeExitDashboardLocator("http://localhost:3001"),
    signingPackages: {
      build: async () => options.signingPackage ?? signingPackage(),
      buildAll: async () => options.signingPackages ?? [options.signingPackage ?? signingPackage()],
    },
    executionVerifier: {
      verify: async (_job, report) => ({
        phase: "COMPLETED",
        completedActionIds: [report.actionId],
        failedActionIds: [],
        transactionHashes: report.transactionHashes,
        observedAt: report.completedAt,
      }),
    },
    monitor: {
      observe: async () => pendingObservations.shift() ?? observation("WAITING_FOR_USER"),
    },
    clock: () => new Date(now),
    idFactory: () => "job:test",
  });
  return { service, store };
}

async function prepareWaitingForUser(service: AgentIncidentService) {
  await service.createIncident({ incident });
  await service.analyseIncident("job:test");
  await service.generatePlan("job:test");
  return service.simulatePlan("job:test");
}

describe("agent service lifecycle", () => {
  it("records RECEIVED before waiting for source", async () => {
    const { service } = createService();
    const job = await service.createIncident({ requestId: "request:empty" });

    expect(job.status).toBe("WAITING_FOR_SOURCE");
    expect(job.requestId).toBe("request:empty");
    expect(job.history.map((entry) => entry.to)).toEqual([
      "RECEIVED",
      "WAITING_FOR_SOURCE",
    ]);

    const analysing = await service.analyseIncident(job.id, incident);
    expect(analysing.status).toBe("ANALYSING");
    expect(analysing.scan?.id).toBe(scan.id);
  });

  it("returns the existing job when a request ID is retried with the same scope", async () => {
    const { service } = createService();
    const first = await service.createIncident({ requestId: "okx:5196:job-1", incident });
    const retry = await service.createIncident({
      requestId: "okx:5196:job-1",
      incident: { ...incident, id: "incident:retry" },
    });

    expect(retry.id).toBe(first.id);
    expect(retry.incident?.id).toBe(incident.id);
  });

  it("rejects request ID reuse with a different wallet scope", async () => {
    const { service } = createService();
    await service.createIncident({ requestId: "okx:5196:job-2", incident });

    await expect(service.createIncident({
      requestId: "okx:5196:job-2",
      incident: { ...incident, destinationAddress: otherDestination },
    })).rejects.toThrow("cannot be reused for a different incident scope");
  });

  it("runs the complete provider-neutral rescue lifecycle", async () => {
    const { service } = createService({
      observations: [
        observation("SIGNING"),
        observation("EXECUTING"),
        observation("COMPLETED"),
      ],
    });

    expect((await service.createIncident({ incident })).status).toBe("RECEIVED");
    expect((await service.getJob("job:test")).dashboardUrl).toBeUndefined();
    expect((await service.analyseIncident("job:test")).status).toBe("ANALYSING");
    expect((await service.generatePlan("job:test")).status).toBe("PLAN_READY");
    expect((await service.simulatePlan("job:test")).status).toBe("WAITING_FOR_USER");
    expect((await service.getSigningPackage("job:test")).route).toBe(
      "ERC2612_PERMIT_SETTLEMENT",
    );
    expect(await service.getDashboardUrl("job:test")).toBe(
      "http://localhost:3001/rescue/job%3Atest",
    );
    expect((await service.monitorRescue("job:test")).status).toBe("SIGNING");
    expect((await service.monitorRescue("job:test")).status).toBe("EXECUTING");
    const completed = await service.monitorRescue("job:test");

    expect(completed.status).toBe("COMPLETED");
    expect(completed.history.map((entry) => entry.to)).toEqual([
      "RECEIVED",
      "ANALYSING",
      "PLAN_READY",
      "WAITING_FOR_USER",
      "SIGNING",
      "EXECUTING",
      "COMPLETED",
    ]);
    expect(completed.monitor?.transactionHashes).toEqual([txHash]);
  });

  it("rejects lifecycle steps that run out of order", async () => {
    const { service } = createService();
    await service.createIncident({ incident });
    await expect(service.generatePlan("job:test")).rejects.toThrow(
      "scan is required",
    );
  });

  it("rejects a signing package that substitutes the destination", async () => {
    const maliciousDestination = evmAddressSchema.parse(
      "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
    );
    const unsafe = signingPackage({
      destinationAddress: maliciousDestination,
      destinationSettlement: {
        executor: maliciousDestination,
        payer: "DESTINATION",
        assembly: "BUYER_LOCAL_RUNTIME",
        atomicRequired: false,
        operations: ["SETTLE_ERC2612"],
      },
    });
    const { service } = createService({ signingPackage: unsafe });
    await prepareWaitingForUser(service);

    await expect(service.getSigningPackage("job:test")).rejects.toThrow(
      "Signing package is unavailable",
    );
  });

  it("rejects a persisted signing package outside its job scope", async () => {
    const { service } = createService();
    await prepareWaitingForUser(service);
    await service.getSigningPackage("job:test");
    const job = await service.getJob("job:test");

    expect(
      agentServiceJobSchema.safeParse({
        ...job,
        signingPackage: {
          ...job.signingPackage,
          planHash: `0x${"4".repeat(64)}`,
        },
      }).success,
    ).toBe(false);
  });

  it("accepts a scoped buyer report only after verifier confirmation", async () => {
    const { service } = createService();
    await prepareWaitingForUser(service);
    await service.getSigningPackage("job:test");

    const completed = await service.recordBuyerExecutionReport("job:test", buyerReport());

    expect(completed.status).toBe("COMPLETED");
    expect(completed.monitor?.transactionHashes).toEqual([txHash]);
  });

  it("issues and verifies an ordered mixed ERC-20 and NFT rescue package set", async () => {
    const mixedPlan: RescuePlan = {
      ...plan,
      actions: [
        ...plan.actions,
        {
          id: "action:nft",
          chainId: incident.chainId,
          sourceAddress: source,
          dependencies: [],
          evidenceIds: ["asset:nft"],
          expectedEffects: [{
            effectType: "ASSET_TRANSFERRED",
            assetId: "asset:nft",
            description: "Move the NFT to the confirmed destination.",
          }],
          riskLevel: "HIGH",
          supportStatus: "SUPPORTED",
          simulationStatus: "PASSED",
          actionType: "TRANSFER_ERC721",
          parameters: {
            collectionAddress: collection,
            recipient: destination,
            tokenId: "42",
          },
        },
      ],
    };
    const tokenSimulation = simulationReport("SUCCEEDED").results[0]!;
    const mixedSimulation: AgentSimulationReport = {
      status: "SUCCEEDED",
      providerId: "test-simulator",
      results: [
        tokenSimulation,
        {
          ...tokenSimulation,
          id: "simulation:nft",
          actionId: "action:nft",
          expectedEffects: mixedPlan.actions[1]!.expectedEffects,
        },
      ],
      executableActionIds: ["action:transfer", "action:nft"],
      excludedActionIds: [],
    };
    const packages = [signingPackage(), nftSigningPackage()];
    const { service } = createService({
      plan: mixedPlan,
      simulation: mixedSimulation,
      signingPackages: packages,
    });
    await prepareWaitingForUser(service);

    expect((await service.getSigningPackages("job:test")).map((item) => item.route)).toEqual([
      "ERC2612_PERMIT_SETTLEMENT",
      "ERC4494_PERMIT_SETTLEMENT",
    ]);

    const first = await service.recordBuyerExecutionReport("job:test", buyerReport());
    expect(first.status).toBe("EXECUTING");
    expect(first.monitor?.completedActionIds).toEqual(["action:transfer"]);

    const nftReport: BuyerExecutionReport = {
      ...buyerReport(),
      packageId: "signing-package:nft",
      actionId: "action:nft",
      route: "ERC4494_PERMIT_SETTLEMENT",
      transactionHashes: [`0x${"b".repeat(64)}`],
    };
    const completed = await service.recordBuyerExecutionReport("job:test", nftReport);
    expect(completed.status).toBe("COMPLETED");
    expect(completed.monitor?.completedActionIds).toEqual(["action:transfer", "action:nft"]);
    expect(completed.monitor?.transactionHashes).toEqual([txHash, `0x${"b".repeat(64)}`]);
  });

  it("returns the completed job for an exact buyer-report retry", async () => {
    const { service } = createService();
    await prepareWaitingForUser(service);
    await service.getSigningPackage("job:test");
    const first = await service.recordBuyerExecutionReport("job:test", buyerReport());
    const retry = await service.recordBuyerExecutionReport("job:test", buyerReport());

    expect(retry.id).toBe(first.id);
    expect(retry.revision).toBe(first.revision);
  });

  it("rejects a changed receipt hash after buyer-report completion", async () => {
    const { service } = createService();
    await prepareWaitingForUser(service);
    await service.getSigningPackage("job:test");
    await service.recordBuyerExecutionReport("job:test", buyerReport());

    await expect(service.recordBuyerExecutionReport("job:test", {
      ...buyerReport(),
      transactionHashes: [`0x${"b".repeat(64)}`],
    })).rejects.toThrow("does not match verified receipts");
  });

  it("rejects a buyer report for another signing package", async () => {
    const { service } = createService();
    await prepareWaitingForUser(service);
    await service.getSigningPackage("job:test");

    await expect(service.recordBuyerExecutionReport("job:test", {
      ...buyerReport(),
      packageId: "signing-package:other",
    })).rejects.toThrow("does not match the issued signing package");
  });

  it("records analysis adapter failures as FAILED", async () => {
    const { service } = createService({ analyzerError: new Error("RPC unavailable") });
    await service.createIncident({ incident });
    const failed = await service.analyseIncident("job:test");

    expect(failed.status).toBe("FAILED");
    expect(failed.error).toEqual({ code: "ANALYSIS_FAILED", message: "RPC unavailable" });
  });

  it("fails closed when no action simulates successfully", async () => {
    const { service } = createService({ simulationStatus: "FAILED" });
    await service.createIncident({ incident });
    await service.analyseIncident("job:test");
    await service.generatePlan("job:test");
    const failed = await service.simulatePlan("job:test");

    expect(failed.status).toBe("FAILED");
    expect(failed.error?.code).toBe("SIMULATION_FAILED");
    expect(failed.simulation?.executableActionIds).toEqual([]);
  });

  it("can observe a partial terminal rescue without executing it", async () => {
    const partialObservation = {
      ...observation("PARTIAL"),
      completedActionIds: [],
      failedActionIds: ["action:transfer"],
    } satisfies RescueMonitorObservation;
    const { service } = createService({ observations: [partialObservation] });
    await prepareWaitingForUser(service);
    const partial = await service.monitorRescue("job:test");

    expect(partial.status).toBe("PARTIAL");
    expect(partial.history.slice(-3).map((entry) => entry.to)).toEqual([
      "SIGNING",
      "EXECUTING",
      "PARTIAL",
    ]);
  });
});

describe("conceptual A2A boundary", () => {
  it("models public wallet context without accepting raw credentials", () => {
    const valid = {
      schemaVersion: "safeexit-a2a-concept-v1",
      requestId: "request:test",
      service: "safeexit-incident-response",
      task: {
        kind: "ANALYSE_AND_PREPARE_RESCUE",
        walletContext: {
          chainId: 31_337,
          sourceAddress: source,
          destinationAddress: destination,
          authorizationConfirmed: true,
        },
      },
    };
    expect(conceptualA2ARequestSchema.safeParse(valid).success).toBe(true);
    expect(
      conceptualA2ARequestSchema.safeParse({
        ...valid,
        task: { ...valid.task, privateKey: `0x${"1".repeat(64)}` },
      }).success,
    ).toBe(false);
  });

  it("returns a conceptual response with every OKX capability unimplemented", async () => {
    const { service } = createService();
    const job = await service.createIncident({ requestId: "request:test" });
    const response = toConceptualA2AResponse("request:test", job);

    expect(response.integrationMode).toBe("CONCEPTUAL_ONLY");
    expect(response.responseStatus).toBe("NEEDS_INPUT");
    expect(response.okxIntegrationBoundaries).toHaveLength(5);
    expect(
      response.okxIntegrationBoundaries.every(
        (boundary) => boundary.status === "OFFICIAL_DOCS_REQUIRED" && !boundary.implemented,
      ),
    ).toBe(true);
    expect(OKX_AI_INTEGRATION_BOUNDARIES.map((boundary) => boundary.capability)).toEqual([
      "ASP_REGISTRATION",
      "ESCROW",
      "AGENTIC_WALLET",
      "MARKETPLACE",
      "SERVICE_DISCOVERY",
    ]);
  });
});
