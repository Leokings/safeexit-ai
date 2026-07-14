import { describe, expect, it } from "vitest";

import { hasVerifiedWalletAtomicBatchAdapter } from "./mainnet-rescue";

describe("mainnet rescue settlement adapters", () => {
  it("fails closed until a wallet atomic batch adapter is verified per chain", () => {
    expect(hasVerifiedWalletAtomicBatchAdapter(196)).toBe(false);
    expect(hasVerifiedWalletAtomicBatchAdapter(1)).toBe(false);
    expect(hasVerifiedWalletAtomicBatchAdapter(8_453)).toBe(false);
  });
});
