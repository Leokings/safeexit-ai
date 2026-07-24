import { describe, expect, it } from "vitest";

import { explainMissingDestinationPaidPackage } from "./live-signing-package-builder";

describe("destination-paid signing-package diagnosis", () => {
  it("distinguishes zero-balance supported assets from unsupported routes", () => {
    const message = explainMissingDestinationPaidPackage(
      {
        assets: [{
          assetType: "ERC20",
          supportStatus: "SUPPORTED",
          balance: "0",
        }] as never,
      },
      { actions: [] },
      0,
    );

    expect(message).toContain("No transferable balance was detected");
    expect(message).toContain("route may be supported");
  });

  it("reports a balance that changed after planning", () => {
    const message = explainMissingDestinationPaidPackage(
      { assets: [] },
      { actions: [{ actionType: "TRANSFER_ERC20" }] as never },
      1,
    );

    expect(message).toContain("fell below its planned transfer amount");
  });
});
