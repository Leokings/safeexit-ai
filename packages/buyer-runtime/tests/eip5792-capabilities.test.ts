import { describe, expect, it } from "vitest";

import {
  assessEip5792Capabilities,
  XLAYER_MAINNET_HEX_CHAIN_ID,
} from "../src/eip5792-capabilities";

describe("assessEip5792Capabilities", () => {
  it("fails closed when X Layer is not advertised", () => {
    expect(
      assessEip5792Capabilities({
        "0x1": { atomic: { status: "supported" } },
      }),
    ).toMatchObject({
      status: "NOT_ADVERTISED",
      chainAdvertised: false,
      safeExitDestinationPaidReady: false,
    });
  });

  it("distinguishes OKX wallet-managed atomic calls from external payment", () => {
    expect(
      assessEip5792Capabilities({
        [XLAYER_MAINNET_HEX_CHAIN_ID]: {
          atomic: { status: "ready" },
        },
      }),
    ).toEqual({
      status: "WALLET_MANAGED_ATOMIC_ONLY",
      chainAdvertised: true,
      atomicStatus: "ready",
      walletManagedAtomicCalls: true,
      eip7702AuthorizationAdvertised: false,
      paymasterServiceAdvertised: false,
      safeExitDestinationPaidReady: false,
      capabilityKeys: ["atomic"],
      reason:
        "The wallet supports wallet-managed atomic calls, but it does not " +
        "advertise the raw authorization and external payer capabilities " +
        "required by SafeExit's destination-paid route.",
    });
  });

  it("keeps draft extended capabilities non-executable", () => {
    expect(
      assessEip5792Capabilities({
        "0xC4": {
          atomic: { status: "supported" },
          eip7702Auth: { supported: true },
          paymasterService: { supported: true },
        },
      }),
    ).toMatchObject({
      status: "UNVERIFIED_EXTENDED_CAPABILITIES",
      chainAdvertised: true,
      walletManagedAtomicCalls: true,
      eip7702AuthorizationAdvertised: true,
      paymasterServiceAdvertised: true,
      safeExitDestinationPaidReady: false,
      capabilityKeys: ["atomic", "eip7702Auth", "paymasterService"],
    });
  });

  it("rejects malformed and misleading capability records", () => {
    expect(
      assessEip5792Capabilities({
        "0xc4": {
          atomic: { status: "unknown" },
          eip7702Auth: false,
          paymasterService: null,
        },
      }),
    ).toMatchObject({
      status: "NOT_ADVERTISED",
      chainAdvertised: true,
      walletManagedAtomicCalls: false,
      eip7702AuthorizationAdvertised: false,
      paymasterServiceAdvertised: false,
      safeExitDestinationPaidReady: false,
    });
  });
});
