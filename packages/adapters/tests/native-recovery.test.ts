import { describe, expect, it } from "vitest";

import { getNativeRecoveryBoundary, nativeRecoveryBoundaries } from "../src";

describe("native recovery integration boundaries", () => {
  it("keeps every native strategy non-executable until official integration proof exists", () => {
    expect(nativeRecoveryBoundaries).toHaveLength(2);
    expect(nativeRecoveryBoundaries.every((boundary) =>
      boundary.status === "OFFICIAL_DOCS_REQUIRED" && boundary.executable === false
    )).toBe(true);
  });

  it("requires audited delegation and a non-public fallback policy", () => {
    expect(
      getNativeRecoveryBoundary("EIP7702_SPONSORED_EXECUTION").requirements.join(" "),
    ).toContain("bytecode-allowlisted");
    expect(
      getNativeRecoveryBoundary("PRIVATE_ATOMIC_BUNDLE").requirements.join(" "),
    ).toContain("public-mempool fallback");
  });
});
