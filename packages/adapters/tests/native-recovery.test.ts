import { describe, expect, it } from "vitest";

import { getNativeRecoveryBoundary, nativeRecoveryBoundaries } from "../src";

describe("native recovery integration boundaries", () => {
  it("exposes only the internally verified X Layer EIP-7702 strategy", () => {
    expect(nativeRecoveryBoundaries).toHaveLength(2);
    expect(
      getNativeRecoveryBoundary("EIP7702_SPONSORED_EXECUTION"),
    ).toMatchObject({
      status: "INTERNALLY_VERIFIED",
      executable: true,
      supportedChainIds: [196],
    });
    expect(
      getNativeRecoveryBoundary("PRIVATE_ATOMIC_BUNDLE"),
    ).toMatchObject({
      status: "OFFICIAL_DOCS_REQUIRED",
      executable: false,
    });
  });

  it("states the public-mempool and external-audit residual risks", () => {
    expect(
      getNativeRecoveryBoundary("EIP7702_SPONSORED_EXECUTION").requirements.join(" "),
    ).toContain("bytecode-pinned");
    expect(
      getNativeRecoveryBoundary("EIP7702_SPONSORED_EXECUTION").residualRisks.join(" "),
    ).toContain("public X Layer mempool");
    expect(
      getNativeRecoveryBoundary("EIP7702_SPONSORED_EXECUTION").residualRisks.join(" "),
    ).toContain("no independent external audit");
  });
});
