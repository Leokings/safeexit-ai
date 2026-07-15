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
const blockHash = `0x${"88".repeat(32)}`;
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

  it("rejects wallet-level atomic batches", async () => {
    const provider: Eip1193Provider = {
      request: async ({ method }) => {
        throw new Error(`Unexpected method ${method}`);
      },
    };
    const wallet = new Eip1193DestinationWallet(provider);

    await expect(wallet.supportsAtomicBatch(196, destination)).resolves.toBe(false);
    await expect(wallet.submit(batch(true, 2))).rejects.toThrow("one non-batched contract call");
  });

  it("uses one destination transaction for a non-batched settlement", async () => {
    const methods: string[] = [];
    const provider: Eip1193Provider = {
      request: async ({ method }) => {
        methods.push(method);
        if (method === "eth_sendTransaction") return txHash;
        if (method === "eth_chainId") return "0xc4";
        if (method === "eth_getTransactionReceipt") {
          return {
            status: "0x1",
            transactionHash: txHash,
            blockNumber: "0x65",
            blockHash,
          };
        }
        if (method === "eth_blockNumber") return "0xa4";
        if (method === "eth_getBlockByNumber") return { hash: blockHash };
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
    expect(receipt.confirmations).toBe(64);
    expect(receipt.canonical).toBe(true);
    expect(methods).toEqual([
      "eth_sendTransaction",
      "eth_chainId",
      "eth_getTransactionReceipt",
      "eth_blockNumber",
      "eth_getBlockByNumber",
      "eth_getTransactionReceipt",
    ]);
  });

  it("does not confirm an included transaction before the chain threshold", async () => {
    const methods: string[] = [];
    const provider: Eip1193Provider = {
      request: async ({ method }) => {
        methods.push(method);
        if (method === "eth_chainId") return "0xc4";
        if (method === "eth_getTransactionReceipt") {
          return { status: "0x1", blockNumber: "0x65", blockHash };
        }
        if (method === "eth_blockNumber") return "0x65";
        throw new Error(`Unexpected method ${method}`);
      },
    };
    const wallet = new Eip1193DestinationWallet(provider, {
      pollIntervalMs: 0,
      maximumPolls: 1,
      sleep: async () => undefined,
    });

    await expect(wallet.waitForReceipt({ submissionId: `tx:${txHash}` })).rejects.toThrow(
      "did not confirm before the local timeout",
    );
    expect(methods).not.toContain("eth_getBlockByNumber");
  });

  it("rejects a reorged receipt block and accepts only a canonical retry", async () => {
    let blockChecks = 0;
    const provider: Eip1193Provider = {
      request: async ({ method }) => {
        if (method === "eth_chainId") return "0xc4";
        if (method === "eth_getTransactionReceipt") {
          return { status: "0x1", blockNumber: "0x65", blockHash };
        }
        if (method === "eth_blockNumber") return "0xa4";
        if (method === "eth_getBlockByNumber") {
          blockChecks += 1;
          return { hash: blockChecks === 1 ? `0x${"99".repeat(32)}` : blockHash };
        }
        throw new Error(`Unexpected method ${method}`);
      },
    };
    const wallet = new Eip1193DestinationWallet(provider, {
      pollIntervalMs: 0,
      maximumPolls: 2,
      clock: () => now,
      sleep: async () => undefined,
    });

    await expect(wallet.waitForReceipt({ submissionId: `tx:${txHash}` })).resolves.toMatchObject({
      status: "CONFIRMED",
      blockHash,
      canonical: true,
    });
    expect(blockChecks).toBe(2);
  });
});
