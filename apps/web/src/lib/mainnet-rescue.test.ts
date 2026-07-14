import { describe, expect, it } from "vitest";

import { getConfiguredPermitSettlementAddress } from "@safeexit/adapters";

describe("mainnet rescue settlement adapters", () => {
  it("configures only the deterministic X Layer settlement address", () => {
    expect(getConfiguredPermitSettlementAddress(196)).toBe(
      "0x964FDCfE0A0bCE568309f3f7D07ab08Fc8F93103",
    );
    expect(getConfiguredPermitSettlementAddress(1)).toBeUndefined();
    expect(getConfiguredPermitSettlementAddress(8_453)).toBeUndefined();
  });
});
