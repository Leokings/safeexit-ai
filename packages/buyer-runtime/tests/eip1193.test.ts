import { describe, expect, it } from "vitest";

import {
  Eip1193DestinationWallet,
  EthSimulateV1AtomicSimulator,
  type Eip1193Provider,
  type SettlementBatch,
} from "../src";

const destination = "0x3333333333333333333333333333333333333333" as const;
const token = "0x4444444444444444444444444444444444444444" as const;
const txHash = `0x${"77".repeat(32)}`;
const now = new Date("2026-07-13T10:00:00.000Z");

function batch(atomicRequired: boolean, callCount = 1): SettlementBatch {
  return {
    packageId: "package:test",
    chainId: 196,
    from: destination,
    atomicRequired,
    calls: Array.from({ length: callCount }, () => ({
      to: token,
      value: "0x0",
      data: "0x1234",
    })),
  };
}

describe("EIP-1193 buyer adapters", () => {
  it("uses eth_simulateV1 for sequential post-signature state simulation", async () => {
    const requests: Array<{ method: string; params?: readonly unknown[] }> = [];
    const provider: Eip1193Provider = {
      request: async (request) => {
        requests.push(request);
        return [{ calls: [{ status: "0x1" }, { status: "0x1" }] }];
      },
    };
    const result = await new EthSimulateV1AtomicSimulator(
      provider,
      "local-geth",
      () => now,
    ).simulate(batch(true, 2));

    expect(result.status).toBe("SUCCEEDED");
    expect(result.callCount).toBe(2);
    expect(requests[0]?.method).toBe("eth_simulateV1");
    expect(JSON.stringify(requests[0]?.params)).toContain(destination);
  });

  it("fails closed when eth_simulateV1 is unsupported or a call reverts", async () => {
    const unsupported = new EthSimulateV1AtomicSimulator({
      request: async () => {
        throw new Error("method not found");
      },
    }, "unsupported", () => now);
    expect((await unsupported.simulate(batch(true, 2))).status).toBe("FAILED");

    const reverted = new EthSimulateV1AtomicSimulator({
      request: async () => [{
        calls: [
          { status: "0x1" },
          { status: "0x0", error: { message: "transferFrom reverted" } },
        ],
      }],
    }, "reverted", () => now);
    await expect(reverted.simulate(batch(true, 2))).resolves.toMatchObject({
      status: "FAILED",
      failureReason: "transferFrom reverted",
    });
  });

  it("submits and monitors an atomic EIP-5792 call batch", async () => {
    let statusReads = 0;
    const methods: string[] = [];
    const provider: Eip1193Provider = {
      request: async ({ method }) => {
        methods.push(method);
        if (method === "eth_requestAccounts") return [destination];
        if (method === "eth_chainId") return "0xc4";
        if (method === "wallet_getCapabilities") {
          return { "0xc4": { atomic: { status: "supported" } } };
        }
        if (method === "wallet_sendCalls") return "0x1234";
        if (method === "wallet_getCallsStatus") {
          statusReads += 1;
          return statusReads === 1
            ? { status: 100, receipts: [] }
            : { status: 200, receipts: [{ transactionHash: txHash }] };
        }
        throw new Error(`Unexpected method ${method}`);
      },
    };
    const wallet = new Eip1193DestinationWallet(provider, {
      pollIntervalMs: 0,
      maximumPolls: 3,
      clock: () => now,
      sleep: async () => undefined,
    });

    expect(await wallet.getAddress()).toBe(destination);
    expect(await wallet.getChainId()).toBe(196);
    expect(await wallet.supportsAtomicBatch(196, destination)).toBe(true);
    const submission = await wallet.submit(batch(true, 2));
    const receipt = await wallet.waitForReceipt(submission);

    expect(receipt.status).toBe("CONFIRMED");
    expect(receipt.transactionHashes).toEqual([txHash]);
    expect(methods).toContain("wallet_sendCalls");
    expect(methods).not.toContain("eth_sendTransaction");
  });

  it("uses one destination transaction for non-atomic ERC-3009 settlement", async () => {
    const methods: string[] = [];
    const provider: Eip1193Provider = {
      request: async ({ method }) => {
        methods.push(method);
        if (method === "eth_sendTransaction") return txHash;
        if (method === "eth_getTransactionReceipt") {
          return { status: "0x1", transactionHash: txHash };
        }
        throw new Error(`Unexpected method ${method}`);
      },
    };
    const wallet = new Eip1193DestinationWallet(provider, {
      pollIntervalMs: 0,
      maximumPolls: 1,
      clock: () => now,
      sleep: async () => undefined,
    });
    const receipt = await wallet.waitForReceipt(await wallet.submit(batch(false)));

    expect(receipt.status).toBe("CONFIRMED");
    expect(methods).toEqual(["eth_sendTransaction", "eth_getTransactionReceipt"]);
  });
});
