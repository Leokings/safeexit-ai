import { describe, expect, it } from "vitest";

import type { PreparedWalletTransaction } from "@safeexit/execution";

import {
  connectOkxWallet,
  ensureXLayerTestnet,
  sendPreparedTestnetTransaction,
  type OkxInjectedProvider,
} from "./okx-wallet";
import { testnetPreflightRequestSchema } from "./testnet-rescue";

const source = "0x1111111111111111111111111111111111111111" as const;
const destination = "0x2222222222222222222222222222222222222222" as const;

class FakeProvider implements OkxInjectedProvider {
  readonly calls: { method: string; params?: readonly unknown[] }[] = [];
  chainId = "0x1";
  rejectSwitchWith4902 = false;

  async request(request: { method: string; params?: readonly unknown[] }): Promise<unknown> {
    this.calls.push(request);
    if (request.method === "eth_requestAccounts") {
      return [source];
    }
    if (request.method === "eth_chainId") {
      return this.chainId;
    }
    if (request.method === "wallet_switchEthereumChain") {
      if (this.rejectSwitchWith4902) {
        this.rejectSwitchWith4902 = false;
        throw { code: 4_902 };
      }
      this.chainId = "0x7a0";
      return null;
    }
    if (request.method === "wallet_addEthereumChain") {
      this.chainId = "0x7a0";
      return null;
    }
    if (request.method === "eth_sendTransaction") {
      return `0x${"a".repeat(64)}`;
    }
    throw new Error(`Unexpected method: ${request.method}`);
  }
}

function transaction(overrides: Partial<PreparedWalletTransaction> = {}): PreparedWalletTransaction {
  return {
    actionId: "action:test",
    chainId: 1_952,
    from: source,
    to: destination,
    value: "0x0",
    ...overrides,
  };
}

describe("OKX injected wallet guardrails", () => {
  it("connects through eth_requestAccounts", async () => {
    const provider = new FakeProvider();
    await expect(connectOkxWallet(provider)).resolves.toBe(source);
    expect(provider.calls[0]?.method).toBe("eth_requestAccounts");
  });

  it("switches to X Layer testnet and adds it only after error 4902", async () => {
    const provider = new FakeProvider();
    provider.rejectSwitchWith4902 = true;

    await ensureXLayerTestnet(provider);

    expect(provider.calls.map((call) => call.method)).toEqual([
      "eth_chainId",
      "wallet_switchEthereumChain",
      "wallet_addEthereumChain",
      "eth_chainId",
    ]);
    expect(provider.chainId).toBe("0x7a0");
  });

  it("rejects wrong-chain and wrong-account transactions before wallet submission", async () => {
    const provider = new FakeProvider();
    await expect(
      sendPreparedTestnetTransaction(provider, transaction({ chainId: 196 }), source),
    ).rejects.toThrow("Only X Layer testnet");
    await expect(
      sendPreparedTestnetTransaction(provider, transaction(), destination),
    ).rejects.toThrow("does not match");
    expect(provider.calls).toHaveLength(0);
  });

  it("submits only the prepared transaction fields", async () => {
    const provider = new FakeProvider();
    const hash = await sendPreparedTestnetTransaction(
      provider,
      transaction({ data: "0x1234" }),
      source,
    );

    expect(hash).toBe(`0x${"a".repeat(64)}`);
    expect(provider.calls).toEqual([
      {
        method: "eth_sendTransaction",
        params: [{ from: source, to: destination, value: "0x0", data: "0x1234" }],
      },
    ]);
  });
});

describe("testnet preflight request", () => {
  it("accepts at most eight validated EVM token addresses", () => {
    expect(testnetPreflightRequestSchema.parse({ tokenAddresses: [source] })).toEqual({
      tokenAddresses: [source],
    });
    expect(() =>
      testnetPreflightRequestSchema.parse({
        tokenAddresses: Array.from({ length: 9 }, (_, index) =>
          `0x${(index + 1).toString(16).padStart(40, "0")}`,
        ),
      }),
    ).toThrow();
    expect(() =>
      testnetPreflightRequestSchema.parse({ tokenAddresses: ["not-an-address"] }),
    ).toThrow();
  });
});
