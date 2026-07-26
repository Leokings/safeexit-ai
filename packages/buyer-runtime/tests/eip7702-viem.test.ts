import { xLayerMainnetConfig } from "@safeexit/chain";
import {
  type Hex,
  type SignedAuthorization,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  type Eip1193DestinationProvider,
  ViemInjectedEip7702DestinationTransport,
  ViemLocalEip7702DestinationTransport,
} from "../src";

const destinationAccount = privateKeyToAccount(
  "0x59c6995e998f97a5a0044976f7d7f9f57f8f149ca2a5c6bede10b1b2b9f2d9b8",
);
const transactionHash = `0x${"71".repeat(32)}` as Hex;
const blockHash = `0x${"88".repeat(32)}` as Hex;
const authorization: SignedAuthorization = {
  address: "0x2000000000000000000000000000000000000002",
  chainId: 196,
  nonce: 7,
  r: `0x${"11".repeat(32)}`,
  s: `0x${"22".repeat(32)}`,
  v: 28n,
  yParity: 1,
};

type PublicClientStub = {
  waitForTransactionReceipt: ReturnType<typeof vi.fn>;
  getBlockNumber: ReturnType<typeof vi.fn>;
  getBlock: ReturnType<typeof vi.fn>;
  getTransactionReceipt: ReturnType<typeof vi.fn>;
  getTransaction: ReturnType<typeof vi.fn>;
};

type TransportInternals = {
  publicClient: PublicClientStub;
  submittedAuthorizations: Map<Hex, readonly SignedAuthorization[]>;
};

function transportWith(transactionReads: readonly unknown[]) {
  const transport = new ViemLocalEip7702DestinationTransport(
    xLayerMainnetConfig,
    "https://rpc.xlayer.tech",
    destinationAccount,
    () => new Date("2026-07-23T10:00:00.000Z"),
  );
  const receipt = {
    status: "success",
    blockNumber: 100n,
    blockHash,
  };
  const getTransaction = vi.fn();
  for (const transaction of transactionReads) {
    getTransaction.mockResolvedValueOnce(transaction);
  }
  const internals = transport as unknown as TransportInternals;
  internals.publicClient = {
    waitForTransactionReceipt: vi.fn().mockResolvedValue(receipt),
    getBlockNumber: vi.fn().mockResolvedValue(200n),
    getBlock: vi.fn().mockResolvedValue({ hash: blockHash }),
    getTransactionReceipt: vi.fn().mockResolvedValue(receipt),
    getTransaction,
  };
  internals.submittedAuthorizations.set(transactionHash, [authorization]);
  return { transport, getTransaction };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("ViemLocalEip7702DestinationTransport", () => {
  it("polls receipt and block state until the confirmation policy is met", async () => {
    vi.useFakeTimers();
    const { transport } = transportWith([
      {
        type: "eip7702",
        authorizationList: [authorization],
      },
    ]);
    const internals = transport as unknown as TransportInternals;
    internals.publicClient.getBlockNumber
      .mockReset()
      .mockResolvedValueOnce(120n)
      .mockResolvedValueOnce(163n);

    const receiptPromise = transport.waitForReceipt(transactionHash);
    await vi.advanceTimersByTimeAsync(1_000);

    await expect(receiptPromise).resolves.toMatchObject({
      status: "CONFIRMED",
      confirmations: 64,
      canonical: true,
    });
    expect(internals.publicClient.getBlockNumber).toHaveBeenCalledTimes(2);
    expect(
      internals.publicClient.waitForTransactionReceipt,
    ).not.toHaveBeenCalled();
  });

  it("accepts an exact authorization after a transient incomplete RPC read", async () => {
    vi.useFakeTimers();
    const { transport, getTransaction } = transportWith([
      { type: "eip1559" },
      {
        type: "eip7702",
        authorizationList: [authorization],
      },
    ]);

    const receiptPromise = transport.waitForReceipt(transactionHash);
    await vi.advanceTimersByTimeAsync(1_000);

    await expect(receiptPromise).resolves.toMatchObject({
      status: "CONFIRMED",
      transactionHashes: [transactionHash],
      canonical: true,
    });
    expect(getTransaction).toHaveBeenCalledTimes(2);
  });

  it("rejects after repeated authorization mismatches", async () => {
    vi.useFakeTimers();
    const mismatched = {
      type: "eip7702",
      authorizationList: [{ ...authorization, nonce: 8 }],
    };
    const { transport, getTransaction } = transportWith(
      Array.from({ length: 5 }, () => mismatched),
    );

    const receiptPromise = transport.waitForReceipt(transactionHash);
    const rejection = expect(receiptPromise).rejects.toThrow(
      "after 5 observations",
    );
    await vi.advanceTimersByTimeAsync(4_000);

    await rejection;
    expect(getTransaction).toHaveBeenCalledTimes(5);
  });
});

function injectedProvider(input: {
  address?: string;
  chainId?: string;
}) {
  const request = vi.fn(async (args: { method: string; params?: unknown }) => {
    switch (args.method) {
      case "eth_chainId":
        return input.chainId ?? "0xc4";
      case "eth_accounts":
        return [input.address ?? destinationAccount.address];
      case "eth_sendTransaction":
        return transactionHash;
      default:
        throw new Error(`Unexpected provider request: ${args.method}`);
    }
  });
  return {
    provider: { request } as unknown as Eip1193DestinationProvider,
    request,
  };
}

describe("ViemInjectedEip7702DestinationTransport", () => {
  it("submits a type-4 transaction from the exact active destination account", async () => {
    const { provider, request } = injectedProvider({});
    const transport = new ViemInjectedEip7702DestinationTransport(
      xLayerMainnetConfig,
      "https://rpc.xlayer.tech",
      provider,
      destinationAccount.address,
    );

    await expect(transport.submit({
      purpose: "RESCUE_ACTION",
      chainId: 196,
      from: destinationAccount.address,
      to: "0x1000000000000000000000000000000000000001",
      value: 0n,
      data: "0x1234",
      authorizationList: [authorization],
      actionIndex: 0,
    })).resolves.toBe(transactionHash);

    const sendCall = request.mock.calls.find(
      ([args]) => args.method === "eth_sendTransaction",
    );
    expect(sendCall).toBeDefined();
    expect(sendCall?.[0].params).toEqual([
      expect.objectContaining({
        from: destinationAccount.address,
        to: "0x1000000000000000000000000000000000000001",
        type: "0x4",
        authorizationList: [expect.objectContaining({
          address: authorization.address,
        })],
      }),
    ]);
  });

  it("rejects when the active account is not the reviewed destination", async () => {
    const { provider, request } = injectedProvider({
      address: "0x9999999999999999999999999999999999999999",
    });
    const transport = new ViemInjectedEip7702DestinationTransport(
      xLayerMainnetConfig,
      "https://rpc.xlayer.tech",
      provider,
      destinationAccount.address,
    );

    await expect(transport.submit({
      purpose: "CLEAR_DELEGATION",
      chainId: 196,
      from: destinationAccount.address,
      to: "0x1000000000000000000000000000000000000001",
      value: 0n,
      data: "0x",
      authorizationList: [authorization],
    })).rejects.toMatchObject({ code: "DESTINATION_MISMATCH" });
    expect(
      request.mock.calls.some(([args]) => args.method === "eth_sendTransaction"),
    ).toBe(false);
  });

  it("rejects when the wallet leaves X Layer", async () => {
    const { provider, request } = injectedProvider({ chainId: "0x1" });
    const transport = new ViemInjectedEip7702DestinationTransport(
      xLayerMainnetConfig,
      "https://rpc.xlayer.tech",
      provider,
      destinationAccount.address,
    );

    await expect(transport.submit({
      purpose: "CLEAR_DELEGATION",
      chainId: 196,
      from: destinationAccount.address,
      to: "0x1000000000000000000000000000000000000001",
      value: 0n,
      data: "0x",
      authorizationList: [authorization],
    })).rejects.toMatchObject({ code: "CHAIN_MISMATCH" });
    expect(
      request.mock.calls.some(([args]) => args.method === "eth_sendTransaction"),
    ).toBe(false);
  });

  it("rejects a transaction request whose payer is not the safe destination", async () => {
    const { provider, request } = injectedProvider({});
    const transport = new ViemInjectedEip7702DestinationTransport(
      xLayerMainnetConfig,
      "https://rpc.xlayer.tech",
      provider,
      destinationAccount.address,
    );

    await expect(transport.submit({
      purpose: "RESCUE_ACTION",
      chainId: 196,
      from: "0x9999999999999999999999999999999999999999",
      to: "0x1000000000000000000000000000000000000001",
      value: 0n,
      data: "0x",
      authorizationList: [authorization],
      actionIndex: 0,
    })).rejects.toMatchObject({ code: "DESTINATION_MISMATCH" });
    expect(request).not.toHaveBeenCalled();
  });
});
