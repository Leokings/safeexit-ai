import { describe, expect, it } from "vitest";

import {
  demoReportSchema,
  deriveDemoActualState,
  executeDemoRequestSchema,
  type DemoChainSnapshot,
} from "./demo-runtime";

const source = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const destination = "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65";
const now = "2026-07-12T12:00:00.000Z";
const report = demoReportSchema.parse({
  schemaVersion: "safeexit-demo-v1",
  incidentId: "demo-31337",
  phase: "READY",
  updatedAt: now,
  executionStartedAt: null,
  executionCompletedAt: null,
  error: null,
  simulation: { status: "PASSED", verifiedAt: now, snapshotReverted: true, actions: [] },
  actions: ["claim", "token", "nft", "revoke"].map((id) => ({
    id: `action:${id}`,
    title: id,
    status: "READY",
    transactionHash: null,
    gasUsed: null,
  })),
  events: [{ sequence: 0, label: "Seeded", status: "COMPLETED", at: now }],
});

function chain(overrides: Partial<DemoChainSnapshot> = {}): DemoChainSnapshot {
  return {
    chainId: 31_337,
    blockNumber: "18",
    sourceNativeBalance: "1000000000000000000",
    sourceTokenBalance: "100000000000000000000",
    destinationTokenBalance: "0",
    claimableReward: "50000000000000000000",
    activeAllowance: "25000000000000000000",
    nftOwner: source,
    ...overrides,
  };
}

describe("demo runtime boundaries", () => {
  it("derives the seeded at-risk state from deterministic chain values", () => {
    expect(deriveDemoActualState(chain(), report, source, destination)).toBe("AT_RISK");
  });

  it("derives the completed state only when every rescue effect is present", () => {
    expect(
      deriveDemoActualState(
        chain({
          sourceTokenBalance: "0",
          destinationTokenBalance: "150000000000000000000",
          claimableReward: "0",
          activeAllowance: "0",
          nftOwner: destination,
        }),
        { ...report, phase: "COMPLETED" },
        source,
        destination,
      ),
    ).toBe("RESCUED");
  });

  it("refuses execution input without explicit authorization or with extra fields", () => {
    expect(() =>
      executeDemoRequestSchema.parse({ incidentId: "demo-31337" }),
    ).toThrow();
    expect(() =>
      executeDemoRequestSchema.parse({
        incidentId: "demo-31337",
        authorizationConfirmed: true,
        privateKey: "never",
      }),
    ).toThrow();
  });
});
