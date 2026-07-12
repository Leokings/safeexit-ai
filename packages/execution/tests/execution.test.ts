import { describe, expect, it } from "vitest";

import { DeterministicRescuePlanner } from "@safeexit/planner";
import { simulationResultSchema, walletScanSchema } from "@safeexit/shared";

import { prepareWalletTransaction } from "../src";

const source = "0x1111111111111111111111111111111111111111" as const;
const destination = "0x2222222222222222222222222222222222222222" as const;
const token = "0x3333333333333333333333333333333333333333" as const;

function fixture() {
  const scan = walletScanSchema.parse({
    id: "scan:live",
    incidentId: "incident:live",
    chainId: 196,
    address: source,
    status: "PARTIAL",
    providerId: "live",
    observedAtBlock: "100",
    observedAt: "2026-07-12T12:00:00.000Z",
    assets: [{
      id: "asset:token",
      chainId: 196,
      ownerAddress: source,
      supportStatus: "SUPPORTED",
      observedAtBlock: "100",
      discoverySource: "rpc",
      confidence: 1,
      assetType: "ERC20",
      contractAddress: token,
      name: "SAFE",
      symbol: "SAFE",
      decimals: 18,
      balance: "25",
    }],
    approvals: [],
    warnings: ["Partial discovery"],
  });
  const plan = new DeterministicRescuePlanner().plan({
    incidentId: "incident:live",
    destinationAddress: destination,
    policyVersion: "test",
    scan,
    adapterCandidates: [],
  });
  const action = plan.actions[0]!;
  const simulation = simulationResultSchema.parse({
    id: "simulation:live",
    planId: plan.id,
    actionId: action.id,
    providerId: "live-rpc",
    status: "SUCCEEDED",
    planHash: plan.integrityHash,
    observedAtBlock: plan.observedAtBlock,
    gasEstimate: "50000",
    expectedEffects: action.expectedEffects,
    assetChanges: [],
    warnings: [],
    simulatedAt: "2026-07-12T12:00:00.000Z",
    expiresAt: "2026-07-12T12:01:00.000Z",
  });
  return { plan, simulation };
}

describe("wallet transaction preparation", () => {
  it("encodes a recipient fixed by the integrity-verified plan", () => {
    const { plan, simulation } = fixture();
    const transaction = prepareWalletTransaction(
      plan,
      simulation,
      new Date("2026-07-12T12:00:30.000Z"),
    );
    expect(transaction.from).toBe(source);
    expect(transaction.to).toBe(token);
    expect(transaction.data).toContain(destination.slice(2).toLowerCase());
    expect(transaction.value).toBe("0x0");
  });

  it("rejects an expired preflight", () => {
    const { plan, simulation } = fixture();
    expect(() =>
      prepareWalletTransaction(
        plan,
        simulation,
        new Date("2026-07-12T12:01:00.000Z"),
      ),
    ).toThrow("Preflight result has expired");
  });

  it("rejects a result whose plan hash was changed", () => {
    const { plan, simulation } = fixture();
    const changed = {
      ...simulation,
      planHash: `0x${"11".repeat(32)}` as const,
    };
    expect(() =>
      prepareWalletTransaction(
        plan,
        changed,
        new Date("2026-07-12T12:00:30.000Z"),
      ),
    ).toThrow("Simulation does not match the verified rescue plan");
  });
});
