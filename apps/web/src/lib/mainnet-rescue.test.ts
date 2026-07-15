import { describe, expect, it } from "vitest";

import {
  getConfiguredPermitSettlementAddress,
  getConfiguredPermitSettlementRuntimeHash,
} from "@safeexit/adapters";

describe("mainnet rescue settlement adapters", () => {
  it("configures only the deterministic X Layer settlement address", () => {
    expect(getConfiguredPermitSettlementAddress(196)).toBe(
      "0x73E8A8d165EC9710aC27f91B0Df02975CC4a48d0",
    );
    expect(getConfiguredPermitSettlementAddress(1)).toBeUndefined();
    expect(getConfiguredPermitSettlementAddress(8_453)).toBeUndefined();
    expect(getConfiguredPermitSettlementRuntimeHash(196)).toBe(
      "0x955c4b306894721c464f129075049c055ba9da3688cf5e538cf5eb90c0cbd3de",
    );
    expect(getConfiguredPermitSettlementRuntimeHash(1)).toBeUndefined();
  });
});
