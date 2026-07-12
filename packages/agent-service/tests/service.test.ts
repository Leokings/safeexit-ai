import { describe, expect, it } from "vitest";

import { evmAddressSchema, type Incident, type RescuePlan, type WalletScan } from "@safeexit/shared";

import {
  AgentIncidentService,
  InMemoryAgentServiceJobStore,
  OKX_AI_INTEGRATION_BOUNDARIES,
  SafeExitDashboardLocator,
  conceptualA2ARequestSchema,
  toConceptualA2AResponse,
  type AgentSimulationReport,
  type RescueMonitorObservation,
} from "../src";

const source = evmAddressSchema.parse("0x70997970C51812dc3A010C7d01b50e0d17dc79C8");
const destination = evmAddressSchema.parse("0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65");
const token = evmAddressSchema.parse("0x5FbDB2315678afecb367f032d93F642f64180aa3");
const planHash = `0x${"3".repeat(64)}`;
const txHash = `0x${"a".repeat(64)}`;
const now = "2026-07-12T10:00:00.000Z";

const incident: Incident = {
  id: "incident:test",
  chainId: 31_337,
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

type ServiceOptions = {
  analyzerError?: Error;
  simulationStatus?: AgentSimulationReport["status"];
  observations?: RescueMonitorObservation[];
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
    planner: { generate: async () => plan },
    simulator: {
      simulate: async () => simulationReport(options.simulationStatus ?? "SUCCEEDED"),
    },
    dashboard: new SafeExitDashboardLocator("http://localhost:3001"),
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

  it("runs the complete provider-neutral rescue lifecycle", async () => {
    const { service } = createService({
      observations: [
        observation("SIGNING"),
        observation("EXECUTING"),
        observation("COMPLETED"),
      ],
    });

    expect((await service.createIncident({ incident })).status).toBe("RECEIVED");
    expect((await service.analyseIncident("job:test")).status).toBe("ANALYSING");
    expect((await service.generatePlan("job:test")).status).toBe("PLAN_READY");
    expect((await service.simulatePlan("job:test")).status).toBe("WAITING_FOR_USER");
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
