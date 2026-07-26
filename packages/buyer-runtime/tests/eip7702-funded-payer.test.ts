import { describe, expect, it } from "vitest";
import { getRescueMainnetChainConfig } from "@safeexit/chain";
import { privateKeyToAccount } from "viem/accounts";

import {
  ViemFundedEip7702PayerSession,
  calculateEip7702GasBudget,
} from "../src";

const fundingAccount = privateKeyToAccount(`0x${"11".repeat(32)}`);
const refundAccount = privateKeyToAccount(`0x${"22".repeat(32)}`);
const payerAccount = privateKeyToAccount(`0x${"33".repeat(32)}`);

describe("EIP-7702 temporary payer budget", () => {
  it("applies the minimum budget for low X Layer gas prices", () => {
    expect(
      calculateEip7702GasBudget({
        gasPrice: 1n,
        actionCount: 2,
      }),
    ).toBe(100_000_000_000_000n);
  });

  it("scales with the committed action count", () => {
    expect(
      calculateEip7702GasBudget({
        gasPrice: 100_000_000n,
        actionCount: 2,
      }),
    ).toBe(1_000_000_000_000_000n);
  });

  it("rejects invalid action counts and budgets above the safety cap", () => {
    expect(() =>
      calculateEip7702GasBudget({
        gasPrice: 1n,
        actionCount: 0,
      }),
    ).toThrow("outside the supported range");
    expect(() =>
      calculateEip7702GasBudget({
        gasPrice: 1_000_000_000n,
        actionCount: 256,
      }),
    ).toThrow("exceeds SafeExit's 0.005 OKB cap");
  });

  it("rejects a caller-supplied funding amount outside the capped budget", async () => {
    const session = new ViemFundedEip7702PayerSession(
      getRescueMainnetChainConfig(196),
      "https://rpc.xlayer.tech",
      {
        request: async () => {
          throw new Error("Funding provider must not be called");
        },
      },
      fundingAccount.address,
      refundAccount.address,
      payerAccount,
    );

    await expect(session.fundGasBudget(1n)).rejects.toThrow(
      "outside SafeExit's capped budget",
    );
    await expect(
      session.fundGasBudget(5_000_000_000_000_001n),
    ).rejects.toThrow("outside SafeExit's capped budget");
  });
});
