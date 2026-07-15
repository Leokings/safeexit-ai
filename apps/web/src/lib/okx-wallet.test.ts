import { encodeAbiParameters, encodeEventTopics } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";

import {
  erc20RescueTypes,
  erc721RescueTypes,
  getConfiguredPermitSettlementAddress,
} from "@safeexit/adapters";
import { evmAddressSchema } from "@safeexit/shared";

import {
  assertRecoveryAuthorizationCurrent,
  connectOkxWallet,
  createDaiPermitPairAuthorization,
  createEip3009Authorization,
  createErc2612PermitAuthorization,
  createErc4494PermitAuthorization,
  ensureRescueMainnet,
  ensureXLayerMainnet,
  getOkxConnectedAccount,
  getOkxProvider,
  receiptProvesCommittedTransfer,
  RECOVERY_AUTHORIZATION_TTL_SECONDS,
  signDaiPermitPair,
  signEip3009Authorization,
  signErc2612Permit,
  signErc4494Permit,
  submitDaiPermitAtomicBatch,
  submitErc2612AtomicBatch,
  submitErc4494AtomicBatch,
  submitEip3009Settlement,
  type OkxInjectedProvider,
  type Eip6963ProviderHost,
} from "./okx-wallet";
import {
  gaslessRouteKey,
  gaslessRescueActionSchema,
  mainnetPreflightRequestSchema,
  requireReviewedGaslessRoute,
} from "./mainnet-rescue";

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
const settlementContract = getConfiguredPermitSettlementAddress(196)!;

const action = gaslessRescueActionSchema.parse({
  actionId: "action:test",
  executionPath: "DIRECT_AUTHORIZATION",
  authorizationStandard: "ERC3009",
  standard: "ERC3009_RECEIVE_WITH_AUTHORIZATION",
  capabilityStatus: "VERIFIED",
  tokenAddress: token,
  from: source,
  to: destination,
  amount: "1250000",
  domain: {
    name: "USD₮0",
    version: "1",
    chainId: 196,
    verifyingContract: token,
  },
});

const permitAction = gaslessRescueActionSchema.parse({
  actionId: "action:permit-test",
  executionPath: "SAFEEXIT_SETTLEMENT",
  authorizationStandard: "ERC2612",
  standard: "ERC2612_PERMIT_SETTLEMENT",
  capabilityStatus: "SIGNATURE_VERIFICATION_REQUIRED",
  tokenAddress: token,
  from: source,
  to: destination,
  amount: "1250000",
  nonce: "7",
  domain: {
    name: "USD₮0",
    version: "1",
    chainId: 196,
    verifyingContract: token,
  },
  settlementContract,
  requiredSignatures: 2,
});

const daiPermitAction = gaslessRescueActionSchema.parse({
  actionId: "action:dai-permit-test",
  executionPath: "SAFEEXIT_SETTLEMENT",
  authorizationStandard: "DAI_PERMIT",
  standard: "DAI_PERMIT_SETTLEMENT",
  capabilityStatus: "SIGNATURE_VERIFICATION_REQUIRED",
  tokenAddress: token,
  from: source,
  to: destination,
  amount: "1250000",
  nonce: "11",
  domain: {
    name: "Dai Stablecoin",
    version: "1",
    chainId: 196,
    verifyingContract: token,
  },
  settlementContract,
  requiredSignatures: 3,
});

const nftPermitAction = gaslessRescueActionSchema.parse({
  actionId: "action:nft-permit-test",
  executionPath: "SAFEEXIT_SETTLEMENT",
  authorizationStandard: "ERC4494",
  standard: "ERC4494_PERMIT_SETTLEMENT",
  capabilityStatus: "SIGNATURE_VERIFICATION_REQUIRED",
  collectionAddress: collection,
  from: source,
  to: destination,
  tokenId: "42",
  nonce: "3",
  domain: {
    name: "SAFEEXIT Demo NFT",
    version: "1",
    chainId: 196,
    verifyingContract: collection,
  },
  settlementContract,
  requiredSignatures: 2,
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

  constructor(
    readonly account = sourceAccount,
    readonly transactionHash = `0x${"a".repeat(64)}`,
  ) {}

  async request(request: { method: string; params?: readonly unknown[] }): Promise<unknown> {
    this.calls.push(request);
    if (request.method === "eth_requestAccounts") {
      return [this.account.address];
    }
    if (request.method === "eth_accounts") {
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
      this.chainId = (request.params?.[0] as { chainId: string }).chainId;
      return null;
    }
    if (request.method === "wallet_addEthereumChain") {
      this.chainId = (request.params?.[0] as { chainId: string }).chainId;
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
        primaryType: "ReceiveWithAuthorization" | "Permit" | "ERC20Rescue" | "ERC721Rescue";
        message: {
          token?: `0x${string}`;
          collection?: `0x${string}`;
          from?: `0x${string}`;
          to?: `0x${string}`;
          owner?: `0x${string}`;
          holder?: `0x${string}`;
          destination?: `0x${string}`;
          spender?: `0x${string}`;
          amount?: string;
          value?: string;
          tokenId?: string;
          permitNonce?: string;
          rescueNonce?: `0x${string}`;
          permitKind?: string;
          validAfter?: string;
          validBefore?: string;
          nonce: string;
          deadline?: string;
          expiry?: string;
          allowed?: boolean;
        };
      };
      if (payload.primaryType === "ERC20Rescue") {
        return this.account.signTypedData({
          domain: payload.domain,
          types: erc20RescueTypes,
          primaryType: "ERC20Rescue",
          message: {
            token: payload.message.token!,
            owner: payload.message.owner!,
            destination: payload.message.destination!,
            amount: BigInt(payload.message.amount!),
            permitNonce: BigInt(payload.message.permitNonce!),
            deadline: BigInt(payload.message.deadline!),
            rescueNonce: payload.message.rescueNonce!,
            permitKind: Number(payload.message.permitKind!),
          },
        });
      }
      if (payload.primaryType === "ERC721Rescue") {
        return this.account.signTypedData({
          domain: payload.domain,
          types: erc721RescueTypes,
          primaryType: "ERC721Rescue",
          message: {
            collection: payload.message.collection!,
            owner: payload.message.owner!,
            destination: payload.message.destination!,
            tokenId: BigInt(payload.message.tokenId!),
            permitNonce: BigInt(payload.message.permitNonce!),
            deadline: BigInt(payload.message.deadline!),
            rescueNonce: payload.message.rescueNonce!,
          },
        });
      }
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
    if (request.method === "eth_sendTransaction") {
      return this.transactionHash;
    }
    throw new Error(`Unexpected method: ${request.method}`);
  }
}

class FakeProviderHost implements Eip6963ProviderHost {
  readonly listeners = new Map<string, Set<EventListener>>();

  constructor(
    readonly okxwallet?: OkxInjectedProvider,
    readonly announcements: unknown[] = [],
  ) {}

  addEventListener(type: string, listener: EventListener) {
    const listeners = this.listeners.get(type) ?? new Set<EventListener>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: EventListener) {
    this.listeners.get(type)?.delete(listener);
  }

  dispatchEvent(event: Event): boolean {
    if (event.type === "eip6963:requestProvider") {
      for (const detail of this.announcements) {
        const announcement = new Event("eip6963:announceProvider");
        Object.defineProperty(announcement, "detail", { value: detail });
        for (const listener of this.listeners.get(announcement.type) ?? []) {
          listener(announcement);
        }
      }
    }
    return true;
  }
}

describe("OKX provider discovery", () => {
  it("prefers the legacy OKX provider when it is available", async () => {
    const provider = new FakeProvider();

    await expect(getOkxProvider(new FakeProviderHost(provider), 5)).resolves.toBe(provider);
  });

  it("discovers OKX Wallet through EIP-6963 among competing wallets", async () => {
    const competingProvider = new FakeProvider();
    const okxProvider = Object.assign(new FakeProvider(), { isOkxWallet: true });
    const host = new FakeProviderHost(undefined, [
      {
        info: {
          uuid: "other",
          name: "Other Wallet",
          icon: "data:image/svg+xml,",
          rdns: "com.other.wallet",
        },
        provider: competingProvider,
      },
      {
        info: {
          uuid: "okx",
          name: "OKX Wallet",
          icon: "data:image/svg+xml,",
          rdns: "com.okx.wallet",
        },
        provider: okxProvider,
      },
    ]);

    await expect(getOkxProvider(host, 5)).resolves.toBe(okxProvider);
  });

  it("rejects when no OKX provider is announced", async () => {
    const host = new FakeProviderHost(undefined, [{
      info: {
        uuid: "other",
        name: "Other Wallet",
        icon: "data:image/svg+xml,",
        rdns: "com.other.wallet",
      },
      provider: new FakeProvider(),
    }]);

    await expect(getOkxProvider(host, 5)).rejects.toThrow("OKX Wallet was not detected");
  });
});

describe("OKX injected wallet guardrails", () => {
  it("connects through eth_requestAccounts", async () => {
    const provider = new FakeProvider();
    await expect(connectOkxWallet(provider)).resolves.toBe(source);
    expect(provider.calls[0]?.method).toBe("eth_requestAccounts");
  });

  it("reads the active account without requesting a new connection", async () => {
    const provider = new FakeProvider();
    await expect(getOkxConnectedAccount(provider)).resolves.toBe(source);
    expect(provider.calls[0]?.method).toBe("eth_accounts");
  });

  it("switches to X Layer mainnet and adds it only after error 4902", async () => {
    const provider = new FakeProvider();
    provider.rejectSwitchWith4902 = true;

    await ensureXLayerMainnet(provider);

    expect(provider.calls.map((call) => call.method)).toEqual([
      "eth_chainId",
      "wallet_switchEthereumChain",
      "wallet_addEthereumChain",
      "eth_chainId",
    ]);
    expect(provider.chainId).toBe("0xc4");
  });

  it("switches to another verified mainnet using its exact chain metadata", async () => {
    const provider = new FakeProvider();
    provider.rejectSwitchWith4902 = true;

    await ensureRescueMainnet(provider, 8_453);

    expect(provider.chainId).toBe("0x2105");
    expect(provider.calls[2]).toMatchObject({
      method: "wallet_addEthereumChain",
      params: [{ chainId: "0x2105", chainName: "Base" }],
    });
  });

  it("binds authorizations to verified mainnets and rejects unknown chains", async () => {
    const baseAction = gaslessRescueActionSchema.parse({
      ...action,
      domain: { ...action.domain, chainId: 8_453 },
    });
    expect(createEip3009Authorization(baseAction).domain.chainId).toBe(8_453);
    expect(gaslessRescueActionSchema.safeParse({
      ...action,
      domain: { ...action.domain, chainId: 10_001 },
    }).success).toBe(false);

    const provider = new FakeProvider();
    await expect(ensureRescueMainnet(provider, 10_001)).rejects.toThrow(
      "Unsupported rescue mainnet chain ID: 10001",
    );
    expect(provider.calls).toHaveLength(0);
  });

  it("creates a short-lived authorization with a caller-provided nonce", () => {
    const nonce = `0x${"12".repeat(32)}` as const;
    const authorization = createEip3009Authorization(action, {
      now: new Date("2026-07-13T12:00:00.000Z"),
      nonce,
    });

    expect(authorization.nonce).toBe(nonce);
    expect(authorization.validBefore - authorization.validAfter).toBe(
      RECOVERY_AUTHORIZATION_TTL_SECONDS + 30n,
    );
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

  it("rejects an expired authorization before settlement simulation", async () => {
    const signed = await signEip3009Authorization(
      new FakeProvider(),
      action,
      source,
      {
        now: new Date("2026-07-13T12:00:00.000Z"),
        nonce: `0x${"45".repeat(32)}`,
      },
    );

    expect(() => assertRecoveryAuthorizationCurrent(signed, {
      now: new Date("2026-07-13T12:15:01.000Z"),
    })).toThrow("expired before settlement");
  });

  it("lets only the destination submit and pay for settlement", async () => {
    const sourceProvider = new FakeProvider();
    const signed = await signEip3009Authorization(sourceProvider, action, source, {
      nonce: `0x${"56".repeat(32)}`,
    });
    const destinationProvider = new FakeProvider(destinationAccount);
    destinationProvider.chainId = "0xc4";

    await expect(
      submitEip3009Settlement(destinationProvider, signed, destination),
    ).resolves.toBe(`0x${"a".repeat(64)}`);
    expect(destinationProvider.calls).toEqual([
      { method: "eth_chainId" },
      { method: "eth_accounts" },
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
    settlementProvider.chainId = "0xc4";

    await expect(
      submitEip3009Settlement(settlementProvider, signed, source),
    ).rejects.toThrow("Only the designated safe destination");
    expect(settlementProvider.calls).toHaveLength(0);
  });

  it("creates an ERC-2612 permit plus a destination-bound rescue authorization", async () => {
    if (permitAction.standard !== "ERC2612_PERMIT_SETTLEMENT") {
      throw new Error("Expected an ERC-2612 action fixture");
    }
    const authorization = createErc2612PermitAuthorization(permitAction, {
      now: new Date("2026-07-13T12:00:00.000Z"),
    });
    expect(authorization.spender).toBe(settlementContract);
    expect(authorization.destination).toBe(destination);
    expect(authorization.nonce).toBe(7n);
    expect(authorization.deadline).toBe(1_783_944_900n);

    const provider = new FakeProvider();
    const signed = await signErc2612Permit(provider, permitAction, source, {
      now: new Date("2026-07-13T12:00:00.000Z"),
    });
    expect(provider.calls.map((call) => call.method)).toEqual([
      "eth_signTypedData_v4",
      "eth_signTypedData_v4",
    ]);
    expect(signed.settlementData).toMatch(/^0x[a-fA-F0-9]+$/);
  });

  it("rejects unconfigured settlement contracts before any permit signing", () => {
    if (
      permitAction.standard !== "ERC2612_PERMIT_SETTLEMENT" ||
      daiPermitAction.standard !== "DAI_PERMIT_SETTLEMENT" ||
      nftPermitAction.standard !== "ERC4494_PERMIT_SETTLEMENT"
    ) {
      throw new Error("Expected permit action fixtures");
    }
    const untrusted = evmAddressSchema.parse(
      "0x4444444444444444444444444444444444444444",
    );

    expect(() => createErc2612PermitAuthorization({
      ...permitAction,
      settlementContract: untrusted,
    })).toThrow("configured SafeExit settlement contract");
    expect(() => createDaiPermitPairAuthorization({
      ...daiPermitAction,
      settlementContract: untrusted,
    })).toThrow("configured SafeExit settlement contract");
    expect(() => createErc4494PermitAuthorization({
      ...nftPermitAction,
      settlementContract: untrusted,
    })).toThrow("configured SafeExit settlement contract");
  });

  it("submits ERC-2612 settlement as one ordinary destination transaction", async () => {
    if (permitAction.standard !== "ERC2612_PERMIT_SETTLEMENT") {
      throw new Error("Expected an ERC-2612 action fixture");
    }
    const sourceProvider = new FakeProvider();
    const signed = await signErc2612Permit(sourceProvider, permitAction, source);
    const destinationProvider = new FakeProvider(destinationAccount);
    destinationProvider.chainId = "0xc4";

    await expect(
      submitErc2612AtomicBatch(destinationProvider, signed, destination),
    ).resolves.toBe(`0x${"a".repeat(64)}`);
    expect(destinationProvider.calls.map((call) => call.method)).toEqual([
      "eth_chainId",
      "eth_accounts",
      "eth_sendTransaction",
    ]);
    const sendRequest = destinationProvider.calls[2];
    expect(sendRequest?.params).toEqual([expect.objectContaining({
      from: destination,
      to: settlementContract,
      data: signed.settlementData,
      value: "0x0",
    })]);
  });

  it("does not depend on wallet atomic-batch capability", async () => {
    if (permitAction.standard !== "ERC2612_PERMIT_SETTLEMENT") {
      throw new Error("Expected an ERC-2612 action fixture");
    }
    const signed = await signErc2612Permit(new FakeProvider(), permitAction, source);
    const destinationProvider = new FakeProvider(destinationAccount);
    destinationProvider.chainId = "0xc4";
    await expect(submitErc2612AtomicBatch(
      destinationProvider,
      signed,
      destination,
    )).resolves.toBe(`0x${"a".repeat(64)}`);
    expect(destinationProvider.calls.map((call) => call.method)).toEqual([
      "eth_chainId",
      "eth_accounts",
      "eth_sendTransaction",
    ]);
  });

  it("creates consecutive DAI-style allow and revoke authorizations", async () => {
    if (daiPermitAction.standard !== "DAI_PERMIT_SETTLEMENT") {
      throw new Error("Expected a DAI-style action fixture");
    }
    const authorization = createDaiPermitPairAuthorization(daiPermitAction, {
      now: new Date("2026-07-13T12:00:00.000Z"),
    });
    expect(authorization.spender).toBe(settlementContract);
    expect(authorization.destination).toBe(destination);
    expect(authorization.allowNonce).toBe(11n);
    expect(authorization.revokeNonce).toBe(12n);
    expect(authorization.expiry).toBe(1_783_944_900n);

    const provider = new FakeProvider();
    const signed = await signDaiPermitPair(provider, daiPermitAction, source, {
      now: new Date("2026-07-13T12:00:00.000Z"),
    });
    expect(provider.calls.map((call) => call.method)).toEqual([
      "eth_signTypedData_v4",
      "eth_signTypedData_v4",
      "eth_signTypedData_v4",
    ]);
    expect(signed.settlementData).toMatch(/^0x[a-fA-F0-9]+$/);
  });

  it("atomically grants, pulls, and revokes a DAI-style allowance", async () => {
    if (daiPermitAction.standard !== "DAI_PERMIT_SETTLEMENT") {
      throw new Error("Expected a DAI-style action fixture");
    }
    const signed = await signDaiPermitPair(
      new FakeProvider(),
      daiPermitAction,
      source,
    );
    const destinationProvider = new FakeProvider(destinationAccount);
    destinationProvider.chainId = "0xc4";

    await expect(
      submitDaiPermitAtomicBatch(destinationProvider, signed, destination),
    ).resolves.toBe(`0x${"a".repeat(64)}`);
    expect(destinationProvider.calls[2]?.params).toEqual([expect.objectContaining({
      from: destination,
      to: settlementContract,
      data: signed.settlementData,
      value: "0x0",
    })]);
  });

  it("signs an ERC-4494 permit that binds the NFT and destination", async () => {
    if (nftPermitAction.standard !== "ERC4494_PERMIT_SETTLEMENT") {
      throw new Error("Expected an ERC-4494 action fixture");
    }
    const authorization = createErc4494PermitAuthorization(nftPermitAction, {
      now: new Date("2026-07-13T12:00:00.000Z"),
    });
    expect(authorization.spender).toBe(settlementContract);
    expect(authorization.destination).toBe(destination);
    expect(authorization.tokenId).toBe(42n);
    expect(authorization.nonce).toBe(3n);

    const signed = await signErc4494Permit(
      new FakeProvider(),
      nftPermitAction,
      source,
      { now: new Date("2026-07-13T12:00:00.000Z") },
    );
    expect(signed.settlementData).toMatch(/^0x[a-fA-F0-9]+$/);
  });

  it("submits NFT permit settlement as one destination-paid transaction", async () => {
    if (nftPermitAction.standard !== "ERC4494_PERMIT_SETTLEMENT") {
      throw new Error("Expected an ERC-4494 action fixture");
    }
    const signed = await signErc4494Permit(new FakeProvider(), nftPermitAction, source);
    const destinationProvider = new FakeProvider(destinationAccount);
    destinationProvider.chainId = "0xc4";

    await expect(
      submitErc4494AtomicBatch(destinationProvider, signed, destination),
    ).resolves.toBe(`0x${"a".repeat(64)}`);
    expect(destinationProvider.calls[2]?.params).toEqual([expect.objectContaining({
      from: destination,
      to: settlementContract,
      data: signed.settlementData,
      value: "0x0",
    })]);
  });

  it("rejects submission if the active destination account changed", async () => {
    if (permitAction.standard !== "ERC2612_PERMIT_SETTLEMENT") {
      throw new Error("Expected an ERC-2612 action fixture");
    }
    const signed = await signErc2612Permit(new FakeProvider(), permitAction, source);
    const wrongProvider = new FakeProvider(sourceAccount);
    wrongProvider.chainId = "0xc4";

    await expect(
      submitErc2612AtomicBatch(wrongProvider, signed, destination),
    ).rejects.toThrow("active OKX Wallet account changed");
    expect(wrongProvider.calls.map((call) => call.method)).toEqual([
      "eth_chainId",
      "eth_accounts",
    ]);
  });

  it("requires an exact committed transfer event before reporting success", async () => {
    if (permitAction.standard !== "ERC2612_PERMIT_SETTLEMENT") {
      throw new Error("Expected an ERC-2612 action fixture");
    }
    const signed = await signErc2612Permit(new FakeProvider(), permitAction, source);
    const transferAbi = [{
      type: "event",
      name: "Transfer",
      inputs: [
        { name: "from", type: "address", indexed: true },
        { name: "to", type: "address", indexed: true },
        { name: "value", type: "uint256", indexed: false },
      ],
    }] as const;
    const exactLog = {
      address: token,
      topics: encodeEventTopics({
        abi: transferAbi,
        eventName: "Transfer",
        args: { from: source, to: destination },
      }) as readonly `0x${string}`[],
      data: encodeAbiParameters([{ type: "uint256" }], [1_250_000n]),
    };

    expect(receiptProvesCommittedTransfer(signed, [exactLog])).toBe(true);
    expect(receiptProvesCommittedTransfer(signed, [{
      ...exactLog,
      data: encodeAbiParameters([{ type: "uint256" }], [1_249_999n]),
    }])).toBe(false);
  });
});

describe("mainnet preflight request", () => {
  it("keeps a reviewed route when only block-scoped evidence IDs change", () => {
    const reviewed = gaslessRouteKey(permitAction);
    const refreshed = {
      ...permitAction,
      actionId: "action:transfer:evidence:fresh-block",
    };

    expect(requireReviewedGaslessRoute([refreshed], reviewed)).toBe(refreshed);
  });

  it("fails closed when a reviewed route commitment changes", () => {
    if (permitAction.standard !== "ERC2612_PERMIT_SETTLEMENT") {
      throw new Error("Expected an ERC-2612 action fixture");
    }
    const reviewed = gaslessRouteKey(permitAction);
    expect(() => requireReviewedGaslessRoute([action], reviewed)).toThrow(
      "selected recovery route changed",
    );
    expect(() => requireReviewedGaslessRoute([{
      ...permitAction,
      actionId: "action:transfer:evidence:fresh-block",
      amount: "1250001",
    }], reviewed)).toThrow("selected recovery route changed");
    expect(() => requireReviewedGaslessRoute([{
      ...permitAction,
      actionId: "action:transfer:evidence:fresh-block",
      nonce: "8",
    }], reviewed)).toThrow("selected recovery route changed");
  });

  it("accepts at most eight validated EVM token addresses", () => {
    expect(mainnetPreflightRequestSchema.parse({ tokenAddresses: [source] })).toEqual({
      tokenAddresses: [source],
      erc721Assets: [],
      erc1155Assets: [],
    });
    expect(() =>
      mainnetPreflightRequestSchema.parse({
        tokenAddresses: Array.from({ length: 9 }, (_, index) =>
          `0x${(index + 1).toString(16).padStart(40, "0")}`,
        ),
      }),
    ).toThrow();
    expect(() =>
      mainnetPreflightRequestSchema.parse({ tokenAddresses: ["not-an-address"] }),
    ).toThrow();
  });

  it("accepts explicit ERC-721 collection and token ID pairs", () => {
    expect(mainnetPreflightRequestSchema.parse({
      tokenAddresses: [],
      erc721Assets: [{ collectionAddress: collection, tokenId: "42" }],
    }).erc721Assets).toEqual([{ collectionAddress: collection, tokenId: "42" }]);
    expect(() => mainnetPreflightRequestSchema.parse({
      tokenAddresses: [],
      erc721Assets: [{ collectionAddress: collection, tokenId: "-1" }],
    })).toThrow();
  });

  it("accepts explicit ERC-1155 collection and token ID pairs", () => {
    expect(mainnetPreflightRequestSchema.parse({
      tokenAddresses: [],
      erc1155Assets: [{ collectionAddress: collection, tokenId: "7" }],
    }).erc1155Assets).toEqual([{ collectionAddress: collection, tokenId: "7" }]);
    expect(() => mainnetPreflightRequestSchema.parse({
      tokenAddresses: [],
      erc1155Assets: [{ collectionAddress: collection, tokenId: "-1" }],
    })).toThrow();
  });

  it("rejects an empty asset batch", () => {
    expect(() => mainnetPreflightRequestSchema.parse({ tokenAddresses: [] })).toThrow();
  });
});
