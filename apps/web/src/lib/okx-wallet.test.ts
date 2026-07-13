import { privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";

import {
  connectOkxWallet,
  createDaiPermitPairAuthorization,
  createEip3009Authorization,
  createErc2612PermitAuthorization,
  createErc4494PermitAuthorization,
  ensureXLayerTestnet,
  getOkxCallsStatus,
  signDaiPermitPair,
  signEip3009Authorization,
  signErc2612Permit,
  signErc4494Permit,
  submitDaiPermitAtomicBatch,
  submitErc2612AtomicBatch,
  submitErc4494AtomicBatch,
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
const collection = "0x3333333333333333333333333333333333333333" as const;

const action = gaslessRescueActionSchema.parse({
  actionId: "action:test",
  standard: "ERC3009_RECEIVE_WITH_AUTHORIZATION",
  capabilityStatus: "VERIFIED",
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

const permitAction = gaslessRescueActionSchema.parse({
  actionId: "action:permit-test",
  standard: "ERC2612_PERMIT_ATOMIC_BATCH",
  capabilityStatus: "SIGNATURE_VERIFICATION_REQUIRED",
  tokenAddress: token,
  from: source,
  to: destination,
  amount: "1250000",
  nonce: "7",
  domain: {
    name: "USD₮0",
    version: "1",
    chainId: 1_952,
    verifyingContract: token,
  },
  requiredWalletCapability: "ATOMIC_BATCH",
});

const daiPermitAction = gaslessRescueActionSchema.parse({
  actionId: "action:dai-permit-test",
  standard: "DAI_PERMIT_ATOMIC_BATCH",
  capabilityStatus: "SIGNATURE_VERIFICATION_REQUIRED",
  tokenAddress: token,
  from: source,
  to: destination,
  amount: "1250000",
  nonce: "11",
  domain: {
    name: "Dai Stablecoin",
    version: "1",
    chainId: 1_952,
    verifyingContract: token,
  },
  requiredWalletCapability: "ATOMIC_BATCH",
  requiredSignatures: 2,
});

const nftPermitAction = gaslessRescueActionSchema.parse({
  actionId: "action:nft-permit-test",
  standard: "ERC4494_PERMIT_ATOMIC_BATCH",
  capabilityStatus: "SIGNATURE_VERIFICATION_REQUIRED",
  collectionAddress: collection,
  from: source,
  to: destination,
  tokenId: "42",
  nonce: "3",
  domain: {
    name: "SAFEEXIT Demo NFT",
    version: "1",
    chainId: 1_952,
    verifyingContract: collection,
  },
  requiredWalletCapability: "ATOMIC_BATCH",
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

const permitTypes = {
  Permit: [
    { name: "owner", type: "address" },
    { name: "spender", type: "address" },
    { name: "value", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

const daiPermitTypes = {
  Permit: [
    { name: "holder", type: "address" },
    { name: "spender", type: "address" },
    { name: "nonce", type: "uint256" },
    { name: "expiry", type: "uint256" },
    { name: "allowed", type: "bool" },
  ],
} as const;

const nftPermitTypes = {
  Permit: [
    { name: "spender", type: "address" },
    { name: "tokenId", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

class FakeProvider implements OkxInjectedProvider {
  readonly calls: { method: string; params?: readonly unknown[] }[] = [];
  chainId = "0x1";
  rejectSwitchWith4902 = false;
  atomicStatus: "supported" | "ready" | "unsupported" = "supported";

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
        primaryType: "ReceiveWithAuthorization" | "Permit";
        message: {
          from?: `0x${string}`;
          to?: `0x${string}`;
          owner?: `0x${string}`;
          holder?: `0x${string}`;
          spender?: `0x${string}`;
          value?: string;
          tokenId?: string;
          validAfter?: string;
          validBefore?: string;
          nonce: string;
          deadline?: string;
          expiry?: string;
          allowed?: boolean;
        };
      };
      if (payload.primaryType === "Permit") {
        if (payload.message.tokenId !== undefined) {
          return this.account.signTypedData({
            domain: payload.domain,
            types: nftPermitTypes,
            primaryType: "Permit",
            message: {
              spender: payload.message.spender!,
              tokenId: BigInt(payload.message.tokenId),
              nonce: BigInt(payload.message.nonce),
              deadline: BigInt(payload.message.deadline!),
            },
          });
        }
        if (payload.message.holder !== undefined) {
          return this.account.signTypedData({
            domain: payload.domain,
            types: daiPermitTypes,
            primaryType: "Permit",
            message: {
              holder: payload.message.holder,
              spender: payload.message.spender!,
              nonce: BigInt(payload.message.nonce),
              expiry: BigInt(payload.message.expiry!),
              allowed: payload.message.allowed!,
            },
          });
        }
        return this.account.signTypedData({
          domain: payload.domain,
          types: permitTypes,
          primaryType: "Permit",
          message: {
            owner: payload.message.owner!,
            spender: payload.message.spender!,
            value: BigInt(payload.message.value!),
            nonce: BigInt(payload.message.nonce),
            deadline: BigInt(payload.message.deadline!),
          },
        });
      }
      return this.account.signTypedData({
        domain: payload.domain,
        types: receiveWithAuthorizationTypes,
        primaryType: "ReceiveWithAuthorization",
        message: {
          from: payload.message.from!,
          to: payload.message.to!,
          nonce: payload.message.nonce as `0x${string}`,
          value: BigInt(payload.message.value!),
          validAfter: BigInt(payload.message.validAfter!),
          validBefore: BigInt(payload.message.validBefore!),
        },
      });
    }
    if (request.method === "wallet_getCapabilities") {
      return { "0x7a0": { atomic: { status: this.atomicStatus } } };
    }
    if (request.method === "wallet_sendCalls") {
      return "0x1234";
    }
    if (request.method === "wallet_getCallsStatus") {
      return {
        status: 200,
        receipts: [{ transactionHash: this.transactionHash }],
      };
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

  it("creates and signs an ERC-2612 permit to the destination", async () => {
    if (permitAction.standard !== "ERC2612_PERMIT_ATOMIC_BATCH") {
      throw new Error("Expected an ERC-2612 action fixture");
    }
    const authorization = createErc2612PermitAuthorization(permitAction, {
      now: new Date("2026-07-13T12:00:00.000Z"),
    });
    expect(authorization.spender).toBe(destination);
    expect(authorization.nonce).toBe(7n);
    expect(authorization.deadline).toBe(1_783_944_300n);

    const provider = new FakeProvider();
    const signed = await signErc2612Permit(provider, permitAction, source, {
      now: new Date("2026-07-13T12:00:00.000Z"),
    });
    expect(signed.permitData.startsWith("0xd505accf")).toBe(true);
    expect(signed.transferFromData.startsWith("0x23b872dd")).toBe(true);
  });

  it("requires destination atomic support for permit settlement", async () => {
    if (permitAction.standard !== "ERC2612_PERMIT_ATOMIC_BATCH") {
      throw new Error("Expected an ERC-2612 action fixture");
    }
    const sourceProvider = new FakeProvider();
    const signed = await signErc2612Permit(sourceProvider, permitAction, source);
    const destinationProvider = new FakeProvider(destinationAccount);
    destinationProvider.chainId = "0x7a0";

    await expect(
      submitErc2612AtomicBatch(destinationProvider, signed, destination),
    ).resolves.toBe("0x1234");
    expect(destinationProvider.calls.map((call) => call.method)).toEqual([
      "eth_chainId",
      "wallet_getCapabilities",
      "wallet_sendCalls",
    ]);
    const sendRequest = destinationProvider.calls[2];
    expect(sendRequest?.params).toEqual([expect.objectContaining({
      from: destination,
      chainId: "0x7a0",
      atomicRequired: true,
      calls: [
        { to: signed.authorization.tokenAddress, data: signed.permitData, value: "0x0" },
        { to: signed.authorization.tokenAddress, data: signed.transferFromData, value: "0x0" },
      ],
    })]);
  });

  it("blocks permit settlement when atomic batching is unavailable", async () => {
    if (permitAction.standard !== "ERC2612_PERMIT_ATOMIC_BATCH") {
      throw new Error("Expected an ERC-2612 action fixture");
    }
    const signed = await signErc2612Permit(new FakeProvider(), permitAction, source);
    const destinationProvider = new FakeProvider(destinationAccount);
    destinationProvider.chainId = "0x7a0";
    destinationProvider.atomicStatus = "unsupported";

    await expect(
      submitErc2612AtomicBatch(destinationProvider, signed, destination),
    ).rejects.toThrow("does not report atomic batch support");
    expect(destinationProvider.calls.map((call) => call.method)).toEqual([
      "eth_chainId",
      "wallet_getCapabilities",
    ]);
  });

  it("creates consecutive DAI-style allow and revoke authorizations", async () => {
    if (daiPermitAction.standard !== "DAI_PERMIT_ATOMIC_BATCH") {
      throw new Error("Expected a DAI-style action fixture");
    }
    const authorization = createDaiPermitPairAuthorization(daiPermitAction, {
      now: new Date("2026-07-13T12:00:00.000Z"),
    });
    expect(authorization.spender).toBe(destination);
    expect(authorization.allowNonce).toBe(11n);
    expect(authorization.revokeNonce).toBe(12n);
    expect(authorization.expiry).toBe(1_783_944_300n);

    const provider = new FakeProvider();
    const signed = await signDaiPermitPair(provider, daiPermitAction, source, {
      now: new Date("2026-07-13T12:00:00.000Z"),
    });
    expect(provider.calls.map((call) => call.method)).toEqual([
      "eth_signTypedData_v4",
      "eth_signTypedData_v4",
    ]);
    expect(signed.allowPermitData.startsWith("0x8fcbaf0c")).toBe(true);
    expect(signed.transferFromData.startsWith("0x23b872dd")).toBe(true);
    expect(signed.revokePermitData.startsWith("0x8fcbaf0c")).toBe(true);
  });

  it("atomically grants, pulls, and revokes a DAI-style allowance", async () => {
    if (daiPermitAction.standard !== "DAI_PERMIT_ATOMIC_BATCH") {
      throw new Error("Expected a DAI-style action fixture");
    }
    const signed = await signDaiPermitPair(
      new FakeProvider(),
      daiPermitAction,
      source,
    );
    const destinationProvider = new FakeProvider(destinationAccount);
    destinationProvider.chainId = "0x7a0";

    await expect(
      submitDaiPermitAtomicBatch(destinationProvider, signed, destination),
    ).resolves.toBe("0x1234");
    expect(destinationProvider.calls[2]?.params).toEqual([expect.objectContaining({
      from: destination,
      chainId: "0x7a0",
      atomicRequired: true,
      calls: [
        { to: signed.authorization.tokenAddress, data: signed.allowPermitData, value: "0x0" },
        { to: signed.authorization.tokenAddress, data: signed.transferFromData, value: "0x0" },
        { to: signed.authorization.tokenAddress, data: signed.revokePermitData, value: "0x0" },
      ],
    })]);
  });

  it("parses confirmed OKX atomic call receipts", async () => {
    const provider = new FakeProvider(destinationAccount);
    await expect(getOkxCallsStatus(provider, "0x1234")).resolves.toEqual({
      status: 200,
      transactionHashes: [`0x${"a".repeat(64)}`],
    });
  });

  it("signs an ERC-4494 permit that binds the NFT and destination", async () => {
    if (nftPermitAction.standard !== "ERC4494_PERMIT_ATOMIC_BATCH") {
      throw new Error("Expected an ERC-4494 action fixture");
    }
    const authorization = createErc4494PermitAuthorization(nftPermitAction, {
      now: new Date("2026-07-13T12:00:00.000Z"),
    });
    expect(authorization.spender).toBe(destination);
    expect(authorization.tokenId).toBe(42n);
    expect(authorization.nonce).toBe(3n);

    const signed = await signErc4494Permit(
      new FakeProvider(),
      nftPermitAction,
      source,
      { now: new Date("2026-07-13T12:00:00.000Z") },
    );
    expect(signed.permitData.startsWith("0x745a41bc")).toBe(true);
    expect(signed.transferFromData.startsWith("0x23b872dd")).toBe(true);
  });

  it("submits NFT permit and transfer as one destination-paid atomic batch", async () => {
    if (nftPermitAction.standard !== "ERC4494_PERMIT_ATOMIC_BATCH") {
      throw new Error("Expected an ERC-4494 action fixture");
    }
    const signed = await signErc4494Permit(new FakeProvider(), nftPermitAction, source);
    const destinationProvider = new FakeProvider(destinationAccount);
    destinationProvider.chainId = "0x7a0";

    await expect(
      submitErc4494AtomicBatch(destinationProvider, signed, destination),
    ).resolves.toBe("0x1234");
    expect(destinationProvider.calls[2]?.params).toEqual([expect.objectContaining({
      atomicRequired: true,
      calls: [
        { to: collection, data: signed.permitData, value: "0x0" },
        { to: collection, data: signed.transferFromData, value: "0x0" },
      ],
    })]);
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

  it("accepts explicit ERC-721 collection and token ID pairs", () => {
    expect(testnetPreflightRequestSchema.parse({
      tokenAddresses: [],
      erc721Assets: [{ collectionAddress: collection, tokenId: "42" }],
    }).erc721Assets).toEqual([{ collectionAddress: collection, tokenId: "42" }]);
    expect(() => testnetPreflightRequestSchema.parse({
      tokenAddresses: [],
      erc721Assets: [{ collectionAddress: collection, tokenId: "-1" }],
    })).toThrow();
  });
});
