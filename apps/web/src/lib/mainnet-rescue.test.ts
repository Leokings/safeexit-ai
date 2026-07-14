import { describe, expect, it } from "vitest";

import { getConfiguredPermitSettlementAddress } from "@safeexit/adapters";

describe("mainnet rescue settlement adapters", () => {
  it("configures only the deterministic X Layer settlement address", () => {
    expect(getConfiguredPermitSettlementAddress(196)).toBe(
      "0x73E8A8d165EC9710aC27f91B0Df02975CC4a48d0",
    );
    expect(getConfiguredPermitSettlementAddress(1)).toBeUndefined();
    expect(getConfiguredPermitSettlementAddress(8_453)).toBeUndefined();
  });
});
