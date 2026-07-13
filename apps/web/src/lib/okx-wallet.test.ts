import { privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";

import {
  connectOkxWallet,
  createEip3009Authorization,
  ensureXLayerTestnet,
  signEip3009Authorization,
  submitEip3009Settlement,
  type OkxInjectedProvider,
} from "./okx-wallet";
import {
  gaslessRescueActionSchema,
  testnetPreflightRequestSchema,
} from "./testnet-rescue";

const sourceAccount = privateKeyToAccount(
  "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
);
const destinationAccount = privateKeyToAccount(
  "0xabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd",
);
const source = sourceAccount.address;
const destination = destinationAccount.address;
const token = "0x9e29b3AADA05BF2d2c827Af80BD28dC0b9B4fb0c" as const;

const action = gaslessRescueActionSchema.parse({
  actionId: "action:test",
  standard: "ERC3009_RECEIVE_WITH_AUTHORIZATION",
  tokenAddress: token,
  from: source,
  to: destination,
  amount: "1250000",
  domain: {
    name: "USD₮0",
    version: "1",
    chainId: 1_952,
    verifyingContract: token,
  },
});

const receiveWithAuthorizationTypes = {
  ReceiveWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

class FakeProvider implements OkxInjectedProvider {
  readonly calls: { method: string; params?: readonly unknown[] }[] = [];
  chainId = "0x1";
  rejectSwitchWith4902 = false;

  constructor(
    readonly account = sourceAccount,
    readonly transactionHash = `0x${"a".repeat(64)}`,
  ) {}

  async request(request: { method: string; params?: readonly unknown[] }): Promise<unknown> {
    this.calls.push(request);
    if (request.method === "eth_requestAccounts") {
      return [this.account.address];
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
    if (request.method === "eth_signTypedData_v4") {
      const payload = JSON.parse(String(request.params?.[1])) as {
        domain: {
          name: string;
          version: string;
          chainId: number;
          verifyingContract: `0x${string}`;
        };
        primaryType: string;
        message: {
          from: `0x${string}`;
          to: `0x${string}`;
          value: string;
          validAfter: string;
          validBefore: string;
          nonce: `0x${string}`;
        };
      };
      return this.account.signTypedData({
        domain: payload.domain,
        types: receiveWithAuthorizationTypes,
        primaryType: "ReceiveWithAuthorization",
        message: {
          ...payload.message,
          value: BigInt(payload.message.value),
          validAfter: BigInt(payload.message.validAfter),
          validBefore: BigInt(payload.message.validBefore),
        },
      });
    }
    if (request.method === "eth_sendTransaction") {
      return this.transactionHash;
    }
    throw new Error(`Unexpected method: ${request.method}`);
  }
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

  it("creates a short-lived authorization with a caller-provided nonce", () => {
    const nonce = `0x${"12".repeat(32)}` as const;
    const authorization = createEip3009Authorization(action, {
      now: new Date("2026-07-13T12:00:00.000Z"),
      nonce,
    });

    expect(authorization.nonce).toBe(nonce);
    expect(authorization.validBefore - authorization.validAfter).toBe(330n);
    expect(authorization.from).toBe(source);
    expect(authorization.to).toBe(destination);
  });

  it("signs typed data offchain and encodes receiveWithAuthorization", async () => {
    const provider = new FakeProvider();
    const signed = await signEip3009Authorization(provider, action, source, {
      now: new Date("2026-07-13T12:00:00.000Z"),
      nonce: `0x${"34".repeat(32)}`,
    });

    expect(provider.calls.map((call) => call.method)).toEqual(["eth_signTypedData_v4"]);
    expect(signed.signature).toMatch(/^0x[0-9a-f]{130}$/i);
    expect(signed.settlementData.startsWith("0xef55bec6")).toBe(true);
  });

  it("lets only the destination submit and pay for settlement", async () => {
    const sourceProvider = new FakeProvider();
    const signed = await signEip3009Authorization(sourceProvider, action, source, {
      nonce: `0x${"56".repeat(32)}`,
    });
    const destinationProvider = new FakeProvider(destinationAccount);
    destinationProvider.chainId = "0x7a0";

    await expect(
      submitEip3009Settlement(destinationProvider, signed, destination),
    ).resolves.toBe(`0x${"a".repeat(64)}`);
    expect(destinationProvider.calls).toEqual([
      { method: "eth_chainId" },
      {
        method: "eth_sendTransaction",
        params: [{
          from: destination,
          to: signed.authorization.tokenAddress,
          value: "0x0",
          data: signed.settlementData,
        }],
      },
    ]);
  });

  it("blocks source-funded and unrelated-account settlement", async () => {
    const provider = new FakeProvider();
    const signed = await signEip3009Authorization(provider, action, source, {
      nonce: `0x${"78".repeat(32)}`,
    });
    const settlementProvider = new FakeProvider();
    settlementProvider.chainId = "0x7a0";

    await expect(
      submitEip3009Settlement(settlementProvider, signed, source),
    ).rejects.toThrow("Only the designated safe destination");
    expect(settlementProvider.calls).toHaveLength(0);
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
