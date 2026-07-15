import { describe, expect, it } from "vitest";

import {
  getConfiguredPermitSettlementAddress,
  getConfiguredPermitSettlementRuntimeHash,
} from "@safeexit/adapters";

describe("mainnet rescue settlement adapters", () => {
  const deployments = [
    [1, "0x1183e94093ad7baf0606bef1755bd56930c1eec1d7a9db4102eac03663bb54cd"],
    [56, "0xd2c64850be4dcb4948925247b5b11be584f650cf0f5bf2402dbc690cbe4c12b1"],
    [137, "0x70baaa06eaac1bb6813d9317e4b04502bdea3a54c4791a5e9d01106458f346f5"],
    [42_161, "0xa5545da519187ecd09cb14d9f814ca467dd361d086775e4cbf8b3ff05c723611"],
    [10, "0xdd90cd4be84e1aedc9d16a9da8bdf6caa040dda8b2b9f312c433caf6be1ade55"],
    [8_453, "0x69ef1ca11c2d4a0bcd0defb53c988d31c1027c0b89afb9bc5317b533de97aa45"],
    [43_114, "0xc3cff642b325f9bef6408b3d17bc6dc4be3b75213eebe58b47e8dadf1ad78de8"],
    [196, "0x955c4b306894721c464f129075049c055ba9da3688cf5e538cf5eb90c0cbd3de"],
  ] as const;

  it.each(deployments)(
    "pins the verified settlement deployment for chain %i",
    (chainId, expectedRuntimeHash) => {
      expect(getConfiguredPermitSettlementAddress(chainId)).toBe(
        "0x73E8A8d165EC9710aC27f91B0Df02975CC4a48d0",
      );
      expect(getConfiguredPermitSettlementRuntimeHash(chainId)).toBe(
        expectedRuntimeHash,
      );
    },
  );

  it("fails closed for chains without a verified deployment", () => {
    expect(getConfiguredPermitSettlementAddress(31_337)).toBeUndefined();
    expect(getConfiguredPermitSettlementRuntimeHash(31_337)).toBeUndefined();
  });
});
