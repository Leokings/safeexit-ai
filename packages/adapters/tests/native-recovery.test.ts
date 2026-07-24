import { describe, expect, it } from "vitest";

import { getNativeRecoveryBoundary, nativeRecoveryBoundaries } from "../src";

describe("native recovery integration boundaries", () => {
  it("keeps every native strategy non-executable until integration proof exists", () => {
    expect(nativeRecoveryBoundaries).toHaveLength(2);
    expect(
      nativeRecoveryBoundaries.every(
        (boundary) => boundary.executable === false,
      ),
    ).toBe(true);
    expect(
      getNativeRecoveryBoundary("EIP7702_SPONSORED_EXECUTION"),
    ).toMatchObject({
      status: "IMPLEMENTATION_TESTING",
      supportedChainIds: [196],
    });
  });

  it("requires verified delegation and a non-public fallback policy", () => {
    expect(
      getNativeRecoveryBoundary("EIP7702_SPONSORED_EXECUTION").requirements.join(" "),
    ).toContain("bytecode-verified");
    expect(
      getNativeRecoveryBoundary("PRIVATE_ATOMIC_BUNDLE").requirements.join(" "),
    ).toContain("public-mempool fallback");
  });
});
