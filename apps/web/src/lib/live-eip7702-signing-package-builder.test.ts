import {
  EIP7702_ACTION_KIND,
  EIP7702_FULL_BALANCE,
} from "@safeexit/adapters";
import { computePlanIntegrityHash } from "@safeexit/planner";
import {
  incidentSchema,
  rescuePlanSchema,
  simulationResultSchema,
  type RescuePlan,
} from "@safeexit/shared";
import { describe, expect, it } from "vitest";

import {
  EIP7702_SIMULATION_PROVIDER_ID,
  assembleEip7702LocalSigningPackage,
  type ReadyEip7702AgentJob,
} from "./live-eip7702-signing-package-builder";

const source = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const destination = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const factory = "0x1000000000000000000000000000000000000001";
const delegate = "0x2000000000000000000000000000000000000002";
const factoryRuntimeHash = `0x${"44".repeat(32)}` as const;
const rescueNonce = `0x${"66".repeat(32)}` as const;
const now = new Date("2026-07-23T10:00:00.000Z");

function rescuePlan(): RescuePlan {
  const payload = {
    id: "plan:test",
    incidentId: "incident:test",
    version: 1,
    policyVersion: "test-v1",
    chainId: 196,
    sourceAddress: source,
    destinationAddress: destination,
    observedAtBlock: "100",
    status: "READY" as const,
    actions: [{
      id: "action:native",
      chainId: 196,
      sourceAddress: source,
      actionType: "TRANSFER_NATIVE" as const,
      parameters: {
        recipient: destination,
        maximumAmount: "1000000000000000000",
        amountStrategy: "MAX_MINUS_GAS_RESERVE" as const,
      },
      dependencies: [],
      evidenceIds: ["asset:native"],
      expectedEffects: [{
        effectType: "ASSET_TRANSFERRED" as const,
        assetId: "asset:native",
        description: "Move the native balance.",
      }],
      riskLevel: "CRITICAL" as const,
      supportStatus: "SUPPORTED" as const,
      simulationStatus: "PASSED" as const,
    }],
    omissions: [],
    createdAt: now.toISOString(),
  };
  const parsed = rescuePlanSchema.parse({
    ...payload,
    integrityHash: `0x${"00".repeat(32)}`,
  });
  const integrityPayload = Object.fromEntries(
    Object.entries(parsed).filter(([key]) => key !== "integrityHash"),
  ) as Omit<RescuePlan, "integrityHash">;
  return rescuePlanSchema.parse({
    ...integrityPayload,
    integrityHash: computePlanIntegrityHash(integrityPayload),
  });
}

function readyJob(overrides: Partial<ReadyEip7702AgentJob> = {}):
ReadyEip7702AgentJob {
  const plan = rescuePlan();
  const simulation = simulationResultSchema.parse({
    id: "simulation:native",
    planId: plan.id,
    actionId: "action:native",
    providerId: EIP7702_SIMULATION_PROVIDER_ID,
    status: "SUCCEEDED",
    planHash: plan.integrityHash,
    observedAtBlock: plan.observedAtBlock,
    expectedEffects: plan.actions[0]?.expectedEffects ?? [],
    assetChanges: [{
      assetType: "NATIVE",
      account: source,
      direction: "DEBIT",
      amount: "1000000000000000000",
    }, {
      assetType: "NATIVE",
      account: destination,
      direction: "CREDIT",
      amount: "1000000000000000000",
    }],
    warnings: [],
    simulatedAt: now.toISOString(),
    expiresAt: "2026-07-23T10:15:00.000Z",
  });
  return {
    id: "job:test",
    service: "safeexit-incident-response",
    status: "WAITING_FOR_USER",
    incident: incidentSchema.parse({
      id: "incident:test",
      chainId: 196,
      sourceAddress: source,
      destinationAddress: destination,
      status: "RECEIVED",
      ownershipAttestation: {
        accepted: true,
        statementVersion: "v1",
        attestedAt: now.toISOString(),
      },
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    }),
    plan,
    simulation: {
      status: "SUCCEEDED",
      providerId: EIP7702_SIMULATION_PROVIDER_ID,
      results: [simulation],
      executableActionIds: ["action:native"],
      excludedActionIds: [],
    },
    history: [{
      sequence: 0,
      from: null,
      to: "WAITING_FOR_USER",
      reason: "JOB_CREATED",
      at: now.toISOString(),
    }],
    revision: 0,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    ...overrides,
  };
}

describe("live EIP-7702 signing-package assembly", () => {
  it("commits a full-balance native action without credential fields", () => {
    const signingPackage = assembleEip7702LocalSigningPackage({
      job: readyJob(),
      factory: {
        address: factory,
        runtimeHash: factoryRuntimeHash,
      },
      delegateAddress: delegate,
      sourceNonce: 7,
      rescueNonce,
      now,
    });

    expect(signingPackage).toMatchObject({
      route: "EIP7702_DELEGATED_RESCUE",
      chainId: 196,
      sourceAddress: source,
      destinationAddress: destination,
      actionIds: ["action:native"],
      executionIndexes: [0],
      simulation: {
        resultIds: ["simulation:native"],
      },
    });
    expect(signingPackage.actions[0]).toMatchObject({
      kind: EIP7702_ACTION_KIND.TRANSFER_NATIVE,
      amount: EIP7702_FULL_BALANCE.toString(),
    });
    expect(JSON.stringify(signingPackage)).not.toMatch(
      /privateKey|seedPhrase|signature/i,
    );
  });

  it("rejects stale simulations and a plan changed after hashing", () => {
    const staleJob = readyJob();
    staleJob.simulation.results[0]!.expiresAt =
      "2026-07-23T09:59:00.000Z";
    expect(() => assembleEip7702LocalSigningPackage({
      job: staleJob,
      factory: { address: factory, runtimeHash: factoryRuntimeHash },
      delegateAddress: delegate,
      sourceNonce: 7,
      rescueNonce,
      now,
    })).toThrow("No supported, freshly simulated");

    const changedJob = readyJob();
    const changedAction = changedJob.plan.actions[0];
    if (changedAction?.actionType !== "TRANSFER_NATIVE") {
      throw new Error("Expected the native test action");
    }
    changedAction.parameters.maximumAmount = "1";
    expect(() => assembleEip7702LocalSigningPackage({
      job: changedJob,
      factory: { address: factory, runtimeHash: factoryRuntimeHash },
      delegateAddress: delegate,
      sourceNonce: 7,
      rescueNonce,
      now,
    })).toThrow("integrity");
  });

  it("never upgrades an ordinary source-gas simulation into EIP-7702", () => {
    const ordinaryJob = readyJob({
      simulation: {
        ...readyJob().simulation,
        providerId: "local-source-funded-simulation",
      },
    });
    expect(() => assembleEip7702LocalSigningPackage({
      job: ordinaryJob,
      factory: { address: factory, runtimeHash: factoryRuntimeHash },
      delegateAddress: delegate,
      sourceNonce: 7,
      rescueNonce,
      now,
    })).toThrow("No supported, freshly simulated");
  });
});
