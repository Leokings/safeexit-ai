import { describe, expect, it, vi } from "vitest";

import {
  executionAttemptSchema,
  mapAgentJob,
  mapExecutionAttempt,
  mapIncident,
  mapRescuePlan,
  mapSimulation,
  mapWalletScan,
  normalizePostgresTlsUrl,
  parsePersistenceEnvironment,
  PrismaSafeExitRepository,
} from "../src";

const source = "0x1111111111111111111111111111111111111111";
const destination = "0x2222222222222222222222222222222222222222";
const token = "0x3333333333333333333333333333333333333333";
const spender = "0x4444444444444444444444444444444444444444";
const hash = `0x${"a".repeat(64)}`;
const now = "2026-07-12T12:00:00.000Z";

const incident = {
  id: "incident-1",
  chainId: 196,
  sourceAddress: source,
  destinationAddress: destination,
  assetManifest: {
    erc20TokenAddresses: [token],
    erc721Assets: [],
    erc1155Assets: [],
  },
  status: "RECEIVED",
  ownershipAttestation: {
    accepted: true,
    statementVersion: "safeexit-auth-v1",
    attestedAt: now,
  },
  createdAt: now,
  updatedAt: now,
} as const;

const scan = {
  id: "scan-1",
  incidentId: incident.id,
  chainId: 196,
  address: source,
  status: "COMPLETE",
  providerId: "local-test",
  observedAtBlock: "42",
  observedAt: now,
  assets: [
    {
      id: "asset-1",
      chainId: 196,
      ownerAddress: source,
      supportStatus: "SUPPORTED",
      observedAtBlock: "42",
      discoverySource: "local-test",
      confidence: 1,
      assetType: "ERC20",
      contractAddress: token,
      name: "Rescue Token",
      symbol: "RSC",
      decimals: 18,
      balance: "1000000000000000000",
      valuation: {
        estimatedValueUsd: 10,
        source: "demo-fixture",
        observedAt: now,
      },
    },
  ],
  approvals: [
    {
      id: "approval-1",
      chainId: 196,
      ownerAddress: source,
      supportStatus: "SUPPORTED",
      observedAtBlock: "42",
      discoverySource: "local-test",
      approvalType: "ERC20_ALLOWANCE",
      tokenAddress: token,
      spenderAddress: spender,
      amount: "100",
    },
  ],
  warnings: [],
} as const;

const plan = {
  id: "plan-1",
  incidentId: incident.id,
  version: 1,
  policyVersion: "planner-v1",
  chainId: 196,
  sourceAddress: source,
  destinationAddress: destination,
  observedAtBlock: "42",
  status: "READY",
  actions: [
    {
      id: "action-1",
      chainId: 196,
      sourceAddress: source,
      dependencies: [],
      evidenceIds: ["asset-1"],
      expectedEffects: [
        {
          effectType: "ASSET_TRANSFERRED",
          assetId: "asset-1",
          description: "Transfer the supported token to the safe destination",
        },
      ],
      riskLevel: "HIGH",
      estimatedValueUsd: 10,
      supportStatus: "SUPPORTED",
      simulationStatus: "PASSED",
      actionType: "TRANSFER_ERC20",
      parameters: {
        tokenAddress: token,
        recipient: destination,
        amount: "1000000000000000000",
      },
    },
  ],
  omissions: [],
  integrityHash: hash,
  createdAt: now,
} as const;

const simulation = {
  id: "simulation-1",
  planId: plan.id,
  actionId: "action-1",
  providerId: "local-test",
  status: "SUCCEEDED",
  planHash: hash,
  observedAtBlock: "42",
  gasEstimate: "52000",
  expectedEffects: plan.actions[0].expectedEffects,
  assetChanges: [
    {
      assetType: "ERC20",
      contractAddress: token,
      account: destination,
      direction: "CREDIT",
      amount: "1000000000000000000",
    },
  ],
  warnings: [],
  simulatedAt: now,
  expiresAt: "2026-07-12T12:05:00.000Z",
} as const;

describe("persistence environment", () => {
  it("accepts only server-side PostgreSQL URLs", () => {
    expect(
      parsePersistenceEnvironment({
        NODE_ENV: "test",
        DATABASE_URL: "postgresql://safeexit:secret@localhost:5432/safeexit",
      }),
    ).toMatchObject({ NODE_ENV: "test" });
    expect(() =>
      parsePersistenceEnvironment({ DATABASE_URL: "mysql://localhost/safeexit" }),
    ).toThrow();
    expect(() => parsePersistenceEnvironment({})).toThrow();
  });

  it("makes PostgreSQL certificate verification explicit", () => {
    const normalized = new URL(
      normalizePostgresTlsUrl(
        "postgresql://safeexit:secret@db.example.com/safeexit?sslmode=require&channel_binding=require",
      ),
    );

    expect(normalized.searchParams.get("sslmode")).toBe("verify-full");
    expect(normalized.searchParams.get("channel_binding")).toBe("require");
  });
});

describe("validated persistence mappings", () => {
  it("maps the complete incident graph without credentials or executable payloads", () => {
    const mappedIncident = mapIncident(incident);
    const mappedScan = mapWalletScan(scan);
    const mappedPlan = mapRescuePlan(plan);
    const mappedSimulation = mapSimulation(simulation);

    expect(mappedIncident.chainId).toBe(196n);
    expect(mappedScan.assets[0]).toMatchObject({
      assetType: "ERC20",
      balance: "1000000000000000000",
    });
    expect(mappedScan.approvals[0]).toMatchObject({
      approvalType: "ERC20_ALLOWANCE",
      spenderAddress: spender,
    });
    expect(mappedPlan.actions[0]).toMatchObject({
      position: 0,
      actionType: "TRANSFER_ERC20",
    });
    expect(mappedSimulation).toMatchObject({ status: "SUCCEEDED" });
    const serialized = JSON.stringify(
      { mappedIncident, mappedScan, mappedPlan, mappedSimulation },
      (_key, value: unknown) => (typeof value === "bigint" ? value.toString() : value),
    );
    expect(serialized).not.toMatch(
      /privateKey|seedPhrase|signature|calldata|rawTransaction/i,
    );
  });

  it("maps execution attempts but rejects signatures and calldata", () => {
    const attempt = {
      id: "attempt-1",
      incidentId: incident.id,
      planId: plan.id,
      attemptNumber: 1,
      status: "SUBMITTED",
      transactionHash: hash,
      submittedAt: now,
      createdAt: now,
      updatedAt: now,
    } as const;
    expect(mapExecutionAttempt(attempt)).toMatchObject({ transactionHash: hash });
    expect(() => executionAttemptSchema.parse({ ...attempt, signature: "0xsecret" })).toThrow();
    expect(() => executionAttemptSchema.parse({ ...attempt, calldata: "0xdeadbeef" })).toThrow();
  });

  it("maps the AgentJob lifecycle and its normalized transitions", () => {
    const mapped = mapAgentJob({
      id: "job-1",
      requestId: "request-1",
      service: "safeexit-incident-response",
      status: "RECEIVED",
      history: [
        {
          sequence: 0,
          from: null,
          to: "RECEIVED",
          reason: "JOB_CREATED",
          at: now,
        },
      ],
      revision: 0,
      createdAt: now,
      updatedAt: now,
    });
    expect(mapped.job).toMatchObject({ status: "RECEIVED", revision: 0 });
    expect(mapped.transitions).toHaveLength(1);
  });
});

describe("repository validation boundary", () => {
  it("validates before writing and upserts a safe incident record", async () => {
    const upsert = vi.fn().mockResolvedValue(undefined);
    const repository = new PrismaSafeExitRepository({ incident: { upsert } } as never);
    await repository.saveIncident(incident);
    expect(upsert).toHaveBeenCalledOnce();
    expect(upsert.mock.calls[0]?.[0].create).not.toHaveProperty("ownershipAttestation");
    expect(upsert.mock.calls[0]?.[0].create.assetManifest).toEqual(
      incident.assetManifest,
    );

    await expect(
      repository.saveIncident({ ...incident, privateKey: "never" }),
    ).rejects.toThrow();
    expect(upsert).toHaveBeenCalledOnce();
  });
});
