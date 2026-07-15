import { describe, expect, it } from "vitest";

import { selectManifestScopedErc20Candidates } from "./asset-manifest-scope";

describe("selectManifestScopedErc20Candidates", () => {
  const first = { tokenAddress: "0x1111111111111111111111111111111111111111", symbol: "ONE" };
  const second = { tokenAddress: "0x2222222222222222222222222222222222222222", symbol: "TWO" };

  it("keeps unique wallet discovery results when no explicit scope exists", () => {
    expect(selectManifestScopedErc20Candidates([
      first,
      { ...first, tokenAddress: first.tokenAddress.toUpperCase() },
      second,
    ])).toEqual([first, second]);
  });

  it("limits discovery to the explicit marketplace manifest", () => {
    expect(selectManifestScopedErc20Candidates(
      [first, second],
      [second.tokenAddress.toUpperCase()],
    )).toEqual([second]);
    expect(selectManifestScopedErc20Candidates([first, second], [])).toEqual([]);
  });
});
