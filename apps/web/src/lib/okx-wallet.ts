import {
  decodeEventLog,
  encodeFunctionData,
  getAddress,
  isAddress,
  parseSignature,
  recoverTypedDataAddress,
  type Hex,
} from "viem";

import {
  getRescueMainnetChainConfig,
  isRescueMainnetChainId,
} from "@safeexit/chain";

import {
  type DaiPermitRescueAction,
  type Erc2612RescueAction,
  type Erc4494RescueAction,
  type GaslessRescueAction,
} from "./mainnet-rescue";

export type OkxInjectedProvider = {
  request(request: { method: string; params?: readonly unknown[] }): Promise<unknown>;
  on?(event: "accountsChanged" | "chainChanged", listener: (...args: unknown[]) => void): void;
  removeListener?(
    event: "accountsChanged" | "chainChanged",
    listener: (...args: unknown[]) => void,
  ): void;
};

type Eip6963ProviderInfo = {
  uuid: string;
  name: string;
  icon: string;
  rdns: string;
};

type Eip6963ProviderDetail = {
  info: Eip6963ProviderInfo;
  provider: OkxInjectedProvider & {
    isOkxWallet?: boolean;
    isOKExWallet?: boolean;
  };
};

export type Eip6963ProviderHost = {
  okxwallet?: OkxInjectedProvider | undefined;
  addEventListener(type: string, listener: EventListener): void;
  removeEventListener(type: string, listener: EventListener): void;
  dispatchEvent(event: Event): boolean;
};

export type Eip3009Authorization = {
  actionId: string;
  tokenAddress: `0x${string}`;
  from: `0x${string}`;
  to: `0x${string}`;
  value: string;
  validAfter: bigint;
  validBefore: bigint;
  nonce: Hex;
  domain: GaslessRescueAction["domain"];
};

export type SignedEip3009Authorization = {
  standard: "ERC3009_RECEIVE_WITH_AUTHORIZATION";
  authorization: Eip3009Authorization;
  signature: Hex;
  settlementData: Hex;
};

export type Erc2612PermitAuthorization = {
  actionId: string;
  tokenAddress: `0x${string}`;
  owner: `0x${string}`;
  spender: `0x${string}`;
  value: string;
  nonce: bigint;
  deadline: bigint;
  domain: Erc2612RescueAction["domain"];
};

export type SignedErc2612Permit = {
  standard: "ERC2612_PERMIT_ATOMIC_BATCH";
  authorization: Erc2612PermitAuthorization;
  signature: Hex;
  permitData: Hex;
  transferFromData: Hex;
};

export type DaiPermitPairAuthorization = {
  actionId: string;
  tokenAddress: `0x${string}`;
  holder: `0x${string}`;
  spender: `0x${string}`;
  value: string;
  allowNonce: bigint;
  revokeNonce: bigint;
  expiry: bigint;
  domain: DaiPermitRescueAction["domain"];
};

export type SignedDaiPermitPair = {
  standard: "DAI_PERMIT_ATOMIC_BATCH";
  authorization: DaiPermitPairAuthorization;
  allowSignature: Hex;
  revokeSignature: Hex;
  allowPermitData: Hex;
  transferFromData: Hex;
  revokePermitData: Hex;
};

export type Erc4494PermitAuthorization = {
  actionId: string;
  collectionAddress: `0x${string}`;
  owner: `0x${string}`;
  spender: `0x${string}`;
  tokenId: bigint;
  nonce: bigint;
  deadline: bigint;
  domain: Erc4494RescueAction["domain"];
};

export type SignedErc4494Permit = {
  standard: "ERC4494_PERMIT_ATOMIC_BATCH";
  authorization: Erc4494PermitAuthorization;
  signature: Hex;
  permitData: Hex;
  transferFromData: Hex;
};

export type SignedRecoveryAuthorization =
  | SignedEip3009Authorization
  | SignedErc2612Permit
  | SignedDaiPermitPair
  | SignedErc4494Permit;

export type OkxCallsStatus = {
  status: 100 | 200 | 400 | 500;
  transactionHashes: Hex[];
};

export type SettlementReceiptLog = {
  address: `0x${string}`;
  data: Hex;
  topics: readonly Hex[];
};

declare global {
  interface Window {
    okxwallet?: OkxInjectedProvider;
  }
}

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

const receiveWithAuthorizationAbi = [
  {
    type: "function",
    name: "receiveWithAuthorization",
    stateMutability: "nonpayable",
    inputs: [
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
      { name: "validAfter", type: "uint256" },
      { name: "validBefore", type: "uint256" },
      { name: "nonce", type: "bytes32" },
      { name: "v", type: "uint8" },
      { name: "r", type: "bytes32" },
      { name: "s", type: "bytes32" },
    ],
    outputs: [],
  },
] as const;

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

export const RECOVERY_AUTHORIZATION_TTL_SECONDS = 15n * 60n;

const erc2612SettlementAbi = [
  {
    type: "function",
    name: "permit",
    stateMutability: "nonpayable",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
      { name: "value", type: "uint256" },
      { name: "deadline", type: "uint256" },
      { name: "v", type: "uint8" },
      { name: "r", type: "bytes32" },
      { name: "s", type: "bytes32" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "transferFrom",
    stateMutability: "nonpayable",
    inputs: [
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

const daiPermitSettlementAbi = [
  {
    type: "function",
    name: "permit",
    stateMutability: "nonpayable",
    inputs: [
      { name: "holder", type: "address" },
      { name: "spender", type: "address" },
      { name: "nonce", type: "uint256" },
      { name: "expiry", type: "uint256" },
      { name: "allowed", type: "bool" },
      { name: "v", type: "uint8" },
      { name: "r", type: "bytes32" },
      { name: "s", type: "bytes32" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "transferFrom",
    stateMutability: "nonpayable",
    inputs: [
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

const erc4494SettlementAbi = [
  {
    type: "function",
    name: "permit",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "tokenId", type: "uint256" },
      { name: "deadline", type: "uint256" },
      { name: "signature", type: "bytes" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "transferFrom",
    stateMutability: "nonpayable",
    inputs: [
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "tokenId", type: "uint256" },
    ],
    outputs: [],
  },
] as const;

const erc20TransferEventAbi = [{
  type: "event",
  name: "Transfer",
  inputs: [
    { name: "from", type: "address", indexed: true },
    { name: "to", type: "address", indexed: true },
    { name: "value", type: "uint256", indexed: false },
  ],
}] as const;

const erc721TransferEventAbi = [{
  type: "event",
  name: "Transfer",
  inputs: [
    { name: "from", type: "address", indexed: true },
    { name: "to", type: "address", indexed: true },
    { name: "tokenId", type: "uint256", indexed: true },
  ],
}] as const;

function providerErrorCode(error: unknown): number | undefined {
  if (!error || typeof error !== "object") {
    return undefined;
  }
  const value = error as { code?: unknown; cause?: unknown };
  return typeof value.code === "number" ? value.code : providerErrorCode(value.cause);
}

function parseAccount(value: unknown): `0x${string}` {
  if (!Array.isArray(value) || typeof value[0] !== "string" || !isAddress(value[0])) {
    throw new Error("OKX Wallet did not return a valid EVM account");
  }
  return getAddress(value[0]);
}

function parseCallsId(value: unknown): string {
  const id = typeof value === "string"
    ? value
    : value && typeof value === "object" && "id" in value
      ? value.id
      : undefined;
  if (typeof id !== "string" || !/^0x[a-fA-F0-9]{2,8192}$/.test(id)) {
    throw new Error("OKX Wallet did not return a valid atomic call identifier");
  }
  return id;
}

function sameAddress(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function rescueChainHex(chainId: number): `0x${string}` {
  if (!isRescueMainnetChainId(chainId)) {
    throw new Error(`Chain ${chainId} does not have a verified rescue adapter`);
  }
  return `0x${chainId.toString(16)}`;
}

function randomNonce(): Hex {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  return `0x${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

function assertSignature(value: unknown): asserts value is Hex {
  if (typeof value !== "string" || !/^0x[a-fA-F0-9]{130}$/.test(value)) {
    throw new Error("OKX Wallet did not return a valid 65-byte authorization signature");
  }
}

function signatureParts(signature: Hex) {
  assertSignature(signature);
  const parsed = parseSignature(signature);
  const v = parsed.v ?? BigInt((parsed.yParity ?? 0) + 27);
  return { v: Number(v), r: parsed.r, s: parsed.s };
}

function typedDataFor(authorization: Eip3009Authorization) {
  return {
    domain: {
      name: authorization.domain.name,
      version: authorization.domain.version,
      chainId: authorization.domain.chainId,
      verifyingContract: getAddress(authorization.domain.verifyingContract),
    },
    types: receiveWithAuthorizationTypes,
    primaryType: "ReceiveWithAuthorization" as const,
    message: {
      from: authorization.from,
      to: authorization.to,
      value: BigInt(authorization.value),
      validAfter: authorization.validAfter,
      validBefore: authorization.validBefore,
      nonce: authorization.nonce,
    },
  };
}

function typedDataRpcPayload(authorization: Eip3009Authorization): string {
  const typedData = typedDataFor(authorization);
  return JSON.stringify({
    ...typedData,
    types: {
      EIP712Domain: [
        { name: "name", type: "string" },
        { name: "version", type: "string" },
        { name: "chainId", type: "uint256" },
        { name: "verifyingContract", type: "address" },
      ],
      ...typedData.types,
    },
    message: {
      ...typedData.message,
      value: typedData.message.value.toString(),
      validAfter: typedData.message.validAfter.toString(),
      validBefore: typedData.message.validBefore.toString(),
    },
  });
}

function isOkxAnnouncement(value: unknown): value is Eip6963ProviderDetail {
  if (!value || typeof value !== "object") {
    return false;
  }
  const detail = value as Partial<Eip6963ProviderDetail>;
  if (
    !detail.info ||
    typeof detail.info.name !== "string" ||
    typeof detail.info.rdns !== "string" ||
    !detail.provider ||
    typeof detail.provider.request !== "function"
  ) {
    return false;
  }
  const name = detail.info.name.trim().toLowerCase();
  const rdnsLabels = detail.info.rdns.toLowerCase().split(".");
  return detail.provider.isOkxWallet === true ||
    detail.provider.isOKExWallet === true ||
    name === "okx wallet" ||
    rdnsLabels.includes("okx") ||
    rdnsLabels.includes("okex");
}

export async function getOkxProvider(
  host: Eip6963ProviderHost | undefined =
    typeof window === "undefined" ? undefined : window,
  timeoutMs = 500,
): Promise<OkxInjectedProvider> {
  if (!host) {
    throw new Error("OKX Wallet requires a browser signing environment");
  }
  if (host.okxwallet) {
    return host.okxwallet;
  }

  return new Promise<OkxInjectedProvider>((resolve, reject) => {
    const onAnnouncement: EventListener = (event) => {
      const detail = (event as CustomEvent<unknown>).detail;
      if (!isOkxAnnouncement(detail)) {
        return;
      }
      host.removeEventListener("eip6963:announceProvider", onAnnouncement);
      globalThis.clearTimeout(timeout);
      resolve(detail.provider);
    };

    host.addEventListener("eip6963:announceProvider", onAnnouncement);
    const timeout = globalThis.setTimeout(() => {
      host.removeEventListener("eip6963:announceProvider", onAnnouncement);
      reject(new Error(
        "OKX Wallet was not detected. Enable its site access for this origin and refresh the page.",
      ));
    }, timeoutMs);
    host.dispatchEvent(new Event("eip6963:requestProvider"));
  });
}

export async function connectOkxWallet(
  provider: OkxInjectedProvider,
): Promise<`0x${string}`> {
  return parseAccount(await provider.request({ method: "eth_requestAccounts" }));
}

export async function getOkxConnectedAccount(
  provider: OkxInjectedProvider,
): Promise<`0x${string}`> {
  return parseAccount(await provider.request({ method: "eth_accounts" }));
}

async function requireActiveAccount(
  provider: OkxInjectedProvider,
  expectedAccount: `0x${string}`,
): Promise<void> {
  const activeAccount = await getOkxConnectedAccount(provider);
  if (!sameAddress(activeAccount, expectedAccount)) {
    throw new Error("The active OKX Wallet account changed before submission");
  }
}

export async function ensureRescueMainnet(
  provider: OkxInjectedProvider,
  chainId: number,
): Promise<void> {
  const config = getRescueMainnetChainConfig(chainId);
  const expectedChainHex = rescueChainHex(chainId);
  const current = await provider.request({ method: "eth_chainId" });
  if (typeof current === "string" && current.toLowerCase() === expectedChainHex) {
    return;
  }

  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: expectedChainHex }],
    });
  } catch (error) {
    if (providerErrorCode(error) !== 4_902) {
      throw error;
    }
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: expectedChainHex,
          chainName: config.chain.name,
          nativeCurrency: config.chain.nativeCurrency,
          rpcUrls: [...config.rpcUrls],
          ...(config.chain.blockExplorers?.default
            ? { blockExplorerUrls: [config.chain.blockExplorers.default.url] }
            : {}),
        },
      ],
    });
  }

  const selected = await provider.request({ method: "eth_chainId" });
  if (typeof selected !== "string" || selected.toLowerCase() !== expectedChainHex) {
    throw new Error(`OKX Wallet is not connected to ${config.chain.name}`);
  }
}

export async function ensureXLayerMainnet(provider: OkxInjectedProvider): Promise<void> {
  return ensureRescueMainnet(provider, 196);
}

export function createEip3009Authorization(
  action: GaslessRescueAction,
  options: { now?: Date; nonce?: Hex } = {},
): Eip3009Authorization {
  if (action.standard !== "ERC3009_RECEIVE_WITH_AUTHORIZATION") {
    throw new Error("The action is not a verified ERC-3009 rescue action");
  }
  if (!isRescueMainnetChainId(action.domain.chainId)) {
    throw new Error("The authorization chain does not have a verified rescue adapter");
  }
  if (action.tokenAddress.toLowerCase() !== action.domain.verifyingContract.toLowerCase()) {
    throw new Error("The verified signing domain does not match the token contract");
  }
  if (action.from.toLowerCase() === action.to.toLowerCase()) {
    throw new Error("Source and destination must be different");
  }
  const now = BigInt(Math.floor((options.now ?? new Date()).getTime() / 1_000));
  return {
    actionId: action.actionId,
    tokenAddress: getAddress(action.tokenAddress),
    from: getAddress(action.from),
    to: getAddress(action.to),
    value: action.amount,
    validAfter: now - 30n,
    validBefore: now + RECOVERY_AUTHORIZATION_TTL_SECONDS,
    nonce: options.nonce ?? randomNonce(),
    domain: action.domain,
  };
}

export function encodeEip3009Settlement(
  authorization: Eip3009Authorization,
  signature: Hex,
): Hex {
  const { v, r, s } = signatureParts(signature);
  return encodeFunctionData({
    abi: receiveWithAuthorizationAbi,
    functionName: "receiveWithAuthorization",
    args: [
      authorization.from,
      authorization.to,
      BigInt(authorization.value),
      authorization.validAfter,
      authorization.validBefore,
      authorization.nonce,
      v,
      r,
      s,
    ],
  });
}

export async function signEip3009Authorization(
  provider: OkxInjectedProvider,
  action: GaslessRescueAction,
  connectedAccount: `0x${string}`,
  options: { now?: Date; nonce?: Hex } = {},
): Promise<SignedEip3009Authorization> {
  if (connectedAccount.toLowerCase() !== action.from.toLowerCase()) {
    throw new Error("Connected account does not match the authorization source");
  }
  const authorization = createEip3009Authorization(action, options);
  const result = await provider.request({
    method: "eth_signTypedData_v4",
    params: [connectedAccount, typedDataRpcPayload(authorization)],
  });
  assertSignature(result);
  const recovered = await recoverTypedDataAddress({
    ...typedDataFor(authorization),
    signature: result,
  });
  if (recovered.toLowerCase() !== authorization.from.toLowerCase()) {
    throw new Error("The authorization signature does not recover to the reported source");
  }
  return {
    standard: "ERC3009_RECEIVE_WITH_AUTHORIZATION",
    authorization,
    signature: result,
    settlementData: encodeEip3009Settlement(authorization, result),
  };
}

function erc2612TypedDataFor(authorization: Erc2612PermitAuthorization) {
  return {
    domain: {
      name: authorization.domain.name,
      version: authorization.domain.version,
      chainId: authorization.domain.chainId,
      verifyingContract: getAddress(authorization.domain.verifyingContract),
    },
    types: permitTypes,
    primaryType: "Permit" as const,
    message: {
      owner: authorization.owner,
      spender: authorization.spender,
      value: BigInt(authorization.value),
      nonce: authorization.nonce,
      deadline: authorization.deadline,
    },
  };
}

function erc2612TypedDataRpcPayload(authorization: Erc2612PermitAuthorization): string {
  const typedData = erc2612TypedDataFor(authorization);
  return JSON.stringify({
    ...typedData,
    types: {
      EIP712Domain: [
        { name: "name", type: "string" },
        { name: "version", type: "string" },
        { name: "chainId", type: "uint256" },
        { name: "verifyingContract", type: "address" },
      ],
      ...typedData.types,
    },
    message: {
      ...typedData.message,
      value: typedData.message.value.toString(),
      nonce: typedData.message.nonce.toString(),
      deadline: typedData.message.deadline.toString(),
    },
  });
}

export function createErc2612PermitAuthorization(
  action: Erc2612RescueAction,
  options: { now?: Date } = {},
): Erc2612PermitAuthorization {
  if (!isRescueMainnetChainId(action.domain.chainId)) {
    throw new Error("The permit chain does not have a verified rescue adapter");
  }
  if (action.tokenAddress.toLowerCase() !== action.domain.verifyingContract.toLowerCase()) {
    throw new Error("The verified signing domain does not match the token contract");
  }
  if (action.from.toLowerCase() === action.to.toLowerCase()) {
    throw new Error("Source and destination must be different");
  }
  const now = BigInt(Math.floor((options.now ?? new Date()).getTime() / 1_000));
  return {
    actionId: action.actionId,
    tokenAddress: getAddress(action.tokenAddress),
    owner: getAddress(action.from),
    spender: getAddress(action.to),
    value: action.amount,
    nonce: BigInt(action.nonce),
    deadline: now + RECOVERY_AUTHORIZATION_TTL_SECONDS,
    domain: action.domain,
  };
}

export function encodeErc2612PermitSettlement(
  authorization: Erc2612PermitAuthorization,
  signature: Hex,
): Pick<SignedErc2612Permit, "permitData" | "transferFromData"> {
  const { v, r, s } = signatureParts(signature);
  return {
    permitData: encodeFunctionData({
      abi: erc2612SettlementAbi,
      functionName: "permit",
      args: [
        authorization.owner,
        authorization.spender,
        BigInt(authorization.value),
        authorization.deadline,
        v,
        r,
        s,
      ],
    }),
    transferFromData: encodeFunctionData({
      abi: erc2612SettlementAbi,
      functionName: "transferFrom",
      args: [
        authorization.owner,
        authorization.spender,
        BigInt(authorization.value),
      ],
    }),
  };
}

export async function signErc2612Permit(
  provider: OkxInjectedProvider,
  action: Erc2612RescueAction,
  connectedAccount: `0x${string}`,
  options: { now?: Date } = {},
): Promise<SignedErc2612Permit> {
  if (connectedAccount.toLowerCase() !== action.from.toLowerCase()) {
    throw new Error("Connected account does not match the permit owner");
  }
  const authorization = createErc2612PermitAuthorization(action, options);
  const result = await provider.request({
    method: "eth_signTypedData_v4",
    params: [connectedAccount, erc2612TypedDataRpcPayload(authorization)],
  });
  assertSignature(result);
  const recovered = await recoverTypedDataAddress({
    ...erc2612TypedDataFor(authorization),
    signature: result,
  });
  if (recovered.toLowerCase() !== authorization.owner.toLowerCase()) {
    throw new Error("The permit signature does not recover to the reported source");
  }
  return {
    standard: "ERC2612_PERMIT_ATOMIC_BATCH",
    authorization,
    signature: result,
    ...encodeErc2612PermitSettlement(authorization, result),
  };
}

function daiPermitTypedDataFor(
  authorization: DaiPermitPairAuthorization,
  allowed: boolean,
) {
  return {
    domain: {
      name: authorization.domain.name,
      version: authorization.domain.version,
      chainId: authorization.domain.chainId,
      verifyingContract: getAddress(authorization.domain.verifyingContract),
    },
    types: daiPermitTypes,
    primaryType: "Permit" as const,
    message: {
      holder: authorization.holder,
      spender: authorization.spender,
      nonce: allowed ? authorization.allowNonce : authorization.revokeNonce,
      expiry: authorization.expiry,
      allowed,
    },
  };
}

function daiPermitTypedDataRpcPayload(
  authorization: DaiPermitPairAuthorization,
  allowed: boolean,
): string {
  const typedData = daiPermitTypedDataFor(authorization, allowed);
  return JSON.stringify({
    ...typedData,
    types: {
      EIP712Domain: [
        { name: "name", type: "string" },
        { name: "version", type: "string" },
        { name: "chainId", type: "uint256" },
        { name: "verifyingContract", type: "address" },
      ],
      ...typedData.types,
    },
    message: {
      ...typedData.message,
      nonce: typedData.message.nonce.toString(),
      expiry: typedData.message.expiry.toString(),
    },
  });
}

export function createDaiPermitPairAuthorization(
  action: DaiPermitRescueAction,
  options: { now?: Date } = {},
): DaiPermitPairAuthorization {
  if (!isRescueMainnetChainId(action.domain.chainId)) {
    throw new Error("The DAI-style permit chain does not have a verified rescue adapter");
  }
  if (action.tokenAddress.toLowerCase() !== action.domain.verifyingContract.toLowerCase()) {
    throw new Error("The verified signing domain does not match the token contract");
  }
  if (action.from.toLowerCase() === action.to.toLowerCase()) {
    throw new Error("Source and destination must be different");
  }
  const allowNonce = BigInt(action.nonce);
  const now = BigInt(Math.floor((options.now ?? new Date()).getTime() / 1_000));
  return {
    actionId: action.actionId,
    tokenAddress: getAddress(action.tokenAddress),
    holder: getAddress(action.from),
    spender: getAddress(action.to),
    value: action.amount,
    allowNonce,
    revokeNonce: allowNonce + 1n,
    expiry: now + RECOVERY_AUTHORIZATION_TTL_SECONDS,
    domain: action.domain,
  };
}

function encodeDaiPermitCall(
  authorization: DaiPermitPairAuthorization,
  allowed: boolean,
  signature: Hex,
): Hex {
  const { v, r, s } = signatureParts(signature);
  return encodeFunctionData({
    abi: daiPermitSettlementAbi,
    functionName: "permit",
    args: [
      authorization.holder,
      authorization.spender,
      allowed ? authorization.allowNonce : authorization.revokeNonce,
      authorization.expiry,
      allowed,
      v,
      r,
      s,
    ],
  });
}

export function encodeDaiPermitSettlement(
  authorization: DaiPermitPairAuthorization,
  allowSignature: Hex,
  revokeSignature: Hex,
): Pick<SignedDaiPermitPair, "allowPermitData" | "transferFromData" | "revokePermitData"> {
  return {
    allowPermitData: encodeDaiPermitCall(authorization, true, allowSignature),
    transferFromData: encodeFunctionData({
      abi: daiPermitSettlementAbi,
      functionName: "transferFrom",
      args: [authorization.holder, authorization.spender, BigInt(authorization.value)],
    }),
    revokePermitData: encodeDaiPermitCall(authorization, false, revokeSignature),
  };
}

export async function signDaiPermitPair(
  provider: OkxInjectedProvider,
  action: DaiPermitRescueAction,
  connectedAccount: `0x${string}`,
  options: { now?: Date } = {},
): Promise<SignedDaiPermitPair> {
  if (connectedAccount.toLowerCase() !== action.from.toLowerCase()) {
    throw new Error("Connected account does not match the DAI-style permit holder");
  }
  const authorization = createDaiPermitPairAuthorization(action, options);
  const allowSignature = await provider.request({
    method: "eth_signTypedData_v4",
    params: [connectedAccount, daiPermitTypedDataRpcPayload(authorization, true)],
  });
  assertSignature(allowSignature);
  const allowSigner = await recoverTypedDataAddress({
    ...daiPermitTypedDataFor(authorization, true),
    signature: allowSignature,
  });
  if (allowSigner.toLowerCase() !== authorization.holder.toLowerCase()) {
    throw new Error("The DAI-style allow signature does not recover to the reported source");
  }
  const revokeSignature = await provider.request({
    method: "eth_signTypedData_v4",
    params: [connectedAccount, daiPermitTypedDataRpcPayload(authorization, false)],
  });
  assertSignature(revokeSignature);
  const revokeSigner = await recoverTypedDataAddress({
    ...daiPermitTypedDataFor(authorization, false),
    signature: revokeSignature,
  });
  if (revokeSigner.toLowerCase() !== authorization.holder.toLowerCase()) {
    throw new Error("The DAI-style revoke signature does not recover to the reported source");
  }
  return {
    standard: "DAI_PERMIT_ATOMIC_BATCH",
    authorization,
    allowSignature,
    revokeSignature,
    ...encodeDaiPermitSettlement(authorization, allowSignature, revokeSignature),
  };
}

function erc4494TypedDataFor(authorization: Erc4494PermitAuthorization) {
  return {
    domain: {
      name: authorization.domain.name,
      version: authorization.domain.version,
      chainId: authorization.domain.chainId,
      verifyingContract: getAddress(authorization.domain.verifyingContract),
    },
    types: nftPermitTypes,
    primaryType: "Permit" as const,
    message: {
      spender: authorization.spender,
      tokenId: authorization.tokenId,
      nonce: authorization.nonce,
      deadline: authorization.deadline,
    },
  };
}

function erc4494TypedDataRpcPayload(authorization: Erc4494PermitAuthorization): string {
  const typedData = erc4494TypedDataFor(authorization);
  return JSON.stringify({
    ...typedData,
    types: {
      EIP712Domain: [
        { name: "name", type: "string" },
        { name: "version", type: "string" },
        { name: "chainId", type: "uint256" },
        { name: "verifyingContract", type: "address" },
      ],
      ...typedData.types,
    },
    message: {
      ...typedData.message,
      tokenId: typedData.message.tokenId.toString(),
      nonce: typedData.message.nonce.toString(),
      deadline: typedData.message.deadline.toString(),
    },
  });
}

export function createErc4494PermitAuthorization(
  action: Erc4494RescueAction,
  options: { now?: Date } = {},
): Erc4494PermitAuthorization {
  if (!isRescueMainnetChainId(action.domain.chainId)) {
    throw new Error("The NFT permit chain does not have a verified rescue adapter");
  }
  if (action.collectionAddress.toLowerCase() !== action.domain.verifyingContract.toLowerCase()) {
    throw new Error("The verified signing domain does not match the NFT collection");
  }
  if (action.from.toLowerCase() === action.to.toLowerCase()) {
    throw new Error("Source and destination must be different");
  }
  const now = BigInt(Math.floor((options.now ?? new Date()).getTime() / 1_000));
  return {
    actionId: action.actionId,
    collectionAddress: getAddress(action.collectionAddress),
    owner: getAddress(action.from),
    spender: getAddress(action.to),
    tokenId: BigInt(action.tokenId),
    nonce: BigInt(action.nonce),
    deadline: now + RECOVERY_AUTHORIZATION_TTL_SECONDS,
    domain: action.domain,
  };
}

export function encodeErc4494PermitSettlement(
  authorization: Erc4494PermitAuthorization,
  signature: Hex,
): Pick<SignedErc4494Permit, "permitData" | "transferFromData"> {
  assertSignature(signature);
  return {
    permitData: encodeFunctionData({
      abi: erc4494SettlementAbi,
      functionName: "permit",
      args: [
        authorization.spender,
        authorization.tokenId,
        authorization.deadline,
        signature,
      ],
    }),
    transferFromData: encodeFunctionData({
      abi: erc4494SettlementAbi,
      functionName: "transferFrom",
      args: [authorization.owner, authorization.spender, authorization.tokenId],
    }),
  };
}

export async function signErc4494Permit(
  provider: OkxInjectedProvider,
  action: Erc4494RescueAction,
  connectedAccount: `0x${string}`,
  options: { now?: Date } = {},
): Promise<SignedErc4494Permit> {
  if (connectedAccount.toLowerCase() !== action.from.toLowerCase()) {
    throw new Error("Connected account does not match the NFT owner");
  }
  const authorization = createErc4494PermitAuthorization(action, options);
  const result = await provider.request({
    method: "eth_signTypedData_v4",
    params: [connectedAccount, erc4494TypedDataRpcPayload(authorization)],
  });
  assertSignature(result);
  const recovered = await recoverTypedDataAddress({
    ...erc4494TypedDataFor(authorization),
    signature: result,
  });
  if (recovered.toLowerCase() !== authorization.owner.toLowerCase()) {
    throw new Error("The NFT permit signature does not recover to the reported source");
  }
  return {
    standard: "ERC4494_PERMIT_ATOMIC_BATCH",
    authorization,
    signature: result,
    ...encodeErc4494PermitSettlement(authorization, result),
  };
}

export async function requireOkxAtomicBatchCapability(
  provider: OkxInjectedProvider,
  account: `0x${string}`,
  chainId: number,
): Promise<void> {
  const expectedChainHex = rescueChainHex(chainId);
  const chain = getRescueMainnetChainConfig(chainId).chain;
  const result = await provider.request({
    method: "wallet_getCapabilities",
    params: [account, [expectedChainHex]],
  });
  if (!result || typeof result !== "object") {
    throw new Error("OKX Wallet did not return atomic batch capabilities");
  }
  const capabilities = Object.entries(result).find(
    ([reportedChainId]) => reportedChainId.toLowerCase() === expectedChainHex,
  )?.[1];
  const atomicStatus =
    capabilities && typeof capabilities === "object" && "atomic" in capabilities
      ? (capabilities.atomic as { status?: unknown }).status
      : undefined;
  if (atomicStatus !== "supported" && atomicStatus !== "ready") {
    throw new Error(
      `OKX Wallet does not report atomic batch support on ${chain.name}`,
    );
  }
}

export function recoveryAuthorizationExpiresAt(
  signed: SignedRecoveryAuthorization,
): bigint {
  if (signed.standard === "ERC3009_RECEIVE_WITH_AUTHORIZATION") {
    return signed.authorization.validBefore;
  }
  if (signed.standard === "DAI_PERMIT_ATOMIC_BATCH") {
    return signed.authorization.expiry;
  }
  return signed.authorization.deadline;
}

export function assertRecoveryAuthorizationCurrent(
  signed: SignedRecoveryAuthorization,
  options: { now?: Date } = {},
): void {
  const now = BigInt(Math.floor((options.now ?? new Date()).getTime() / 1_000));
  if (
    signed.standard === "ERC3009_RECEIVE_WITH_AUTHORIZATION" &&
    now <= signed.authorization.validAfter
  ) {
    throw new Error(
      "The source authorization is not valid yet. Check the device clock and sign a fresh authorization.",
    );
  }
  if (now >= recoveryAuthorizationExpiresAt(signed)) {
    throw new Error(
      "The source authorization expired before settlement. Switch back to the source account and sign a fresh authorization.",
    );
  }
}

export async function submitErc2612AtomicBatch(
  provider: OkxInjectedProvider,
  signed: SignedErc2612Permit,
  connectedAccount: `0x${string}`,
): Promise<string> {
  if (connectedAccount.toLowerCase() !== signed.authorization.spender.toLowerCase()) {
    throw new Error("Only the designated safe destination can submit this permit batch");
  }
  assertRecoveryAuthorizationCurrent(signed);
  const chainId = await provider.request({ method: "eth_chainId" });
  const expectedChainHex = rescueChainHex(signed.authorization.domain.chainId);
  if (typeof chainId !== "string" || chainId.toLowerCase() !== expectedChainHex) {
    throw new Error("OKX Wallet is not connected to the authorization chain");
  }
  await requireActiveAccount(provider, connectedAccount);
  await requireOkxAtomicBatchCapability(
    provider,
    connectedAccount,
    signed.authorization.domain.chainId,
  );
  const result = await provider.request({
    method: "wallet_sendCalls",
    params: [{
      version: "2.0.0",
      from: connectedAccount,
      chainId: expectedChainHex,
      atomicRequired: true,
      calls: [
        { to: signed.authorization.tokenAddress, data: signed.permitData, value: "0x0" },
        { to: signed.authorization.tokenAddress, data: signed.transferFromData, value: "0x0" },
      ],
    }],
  });
  return parseCallsId(result);
}

export async function submitDaiPermitAtomicBatch(
  provider: OkxInjectedProvider,
  signed: SignedDaiPermitPair,
  connectedAccount: `0x${string}`,
): Promise<string> {
  if (connectedAccount.toLowerCase() !== signed.authorization.spender.toLowerCase()) {
    throw new Error("Only the designated safe destination can submit this DAI-style permit batch");
  }
  if (signed.authorization.revokeNonce !== signed.authorization.allowNonce + 1n) {
    throw new Error("The DAI-style revoke nonce must immediately follow the allow nonce");
  }
  assertRecoveryAuthorizationCurrent(signed);
  const chainId = await provider.request({ method: "eth_chainId" });
  const expectedChainHex = rescueChainHex(signed.authorization.domain.chainId);
  if (typeof chainId !== "string" || chainId.toLowerCase() !== expectedChainHex) {
    throw new Error("OKX Wallet is not connected to the authorization chain");
  }
  await requireActiveAccount(provider, connectedAccount);
  await requireOkxAtomicBatchCapability(
    provider,
    connectedAccount,
    signed.authorization.domain.chainId,
  );
  const result = await provider.request({
    method: "wallet_sendCalls",
    params: [{
      version: "2.0.0",
      from: connectedAccount,
      chainId: expectedChainHex,
      atomicRequired: true,
      calls: [
        { to: signed.authorization.tokenAddress, data: signed.allowPermitData, value: "0x0" },
        { to: signed.authorization.tokenAddress, data: signed.transferFromData, value: "0x0" },
        { to: signed.authorization.tokenAddress, data: signed.revokePermitData, value: "0x0" },
      ],
    }],
  });
  return parseCallsId(result);
}

export async function submitErc4494AtomicBatch(
  provider: OkxInjectedProvider,
  signed: SignedErc4494Permit,
  connectedAccount: `0x${string}`,
): Promise<string> {
  if (connectedAccount.toLowerCase() !== signed.authorization.spender.toLowerCase()) {
    throw new Error("Only the designated safe destination can submit this NFT permit batch");
  }
  assertRecoveryAuthorizationCurrent(signed);
  const chainId = await provider.request({ method: "eth_chainId" });
  const expectedChainHex = rescueChainHex(signed.authorization.domain.chainId);
  if (typeof chainId !== "string" || chainId.toLowerCase() !== expectedChainHex) {
    throw new Error("OKX Wallet is not connected to the authorization chain");
  }
  await requireActiveAccount(provider, connectedAccount);
  await requireOkxAtomicBatchCapability(
    provider,
    connectedAccount,
    signed.authorization.domain.chainId,
  );
  const result = await provider.request({
    method: "wallet_sendCalls",
    params: [{
      version: "2.0.0",
      from: connectedAccount,
      chainId: expectedChainHex,
      atomicRequired: true,
      calls: [
        { to: signed.authorization.collectionAddress, data: signed.permitData, value: "0x0" },
        { to: signed.authorization.collectionAddress, data: signed.transferFromData, value: "0x0" },
      ],
    }],
  });
  return parseCallsId(result);
}

export async function getOkxCallsStatus(
  provider: OkxInjectedProvider,
  callsId: string,
): Promise<OkxCallsStatus> {
  const result = await provider.request({
    method: "wallet_getCallsStatus",
    params: [callsId],
  });
  if (!result || typeof result !== "object" || !("status" in result)) {
    throw new Error("OKX Wallet returned an invalid atomic call status");
  }
  const status = Number(result.status);
  if (status !== 100 && status !== 200 && status !== 400 && status !== 500) {
    throw new Error("OKX Wallet returned an unknown atomic call status");
  }
  const receipts = "receipts" in result && Array.isArray(result.receipts)
    ? result.receipts
    : [];
  const transactionHashes = receipts.flatMap((receipt) => {
    if (!receipt || typeof receipt !== "object" || !("transactionHash" in receipt)) {
      return [];
    }
    const hash = receipt.transactionHash;
    return typeof hash === "string" && /^0x[a-fA-F0-9]{64}$/.test(hash)
      ? [hash as Hex]
      : [];
  });
  return { status, transactionHashes };
}

export async function submitEip3009Settlement(
  provider: OkxInjectedProvider,
  signed: SignedEip3009Authorization,
  connectedAccount: `0x${string}`,
): Promise<Hex> {
  if (connectedAccount.toLowerCase() !== signed.authorization.to.toLowerCase()) {
    throw new Error("Only the designated safe destination can submit this authorization");
  }
  assertRecoveryAuthorizationCurrent(signed);
  const chainId = await provider.request({ method: "eth_chainId" });
  const expectedChainHex = rescueChainHex(signed.authorization.domain.chainId);
  if (typeof chainId !== "string" || chainId.toLowerCase() !== expectedChainHex) {
    throw new Error("OKX Wallet is not connected to the authorization chain");
  }
  await requireActiveAccount(provider, connectedAccount);
  const result = await provider.request({
    method: "eth_sendTransaction",
    params: [
      {
        from: connectedAccount,
        to: signed.authorization.tokenAddress,
        value: "0x0",
        data: signed.settlementData,
      },
    ],
  });
  if (typeof result !== "string" || !/^0x[a-fA-F0-9]{64}$/.test(result)) {
    throw new Error("OKX Wallet did not return a valid transaction hash");
  }
  return result as Hex;
}

export function receiptProvesCommittedTransfer(
  signed: SignedRecoveryAuthorization,
  logs: readonly SettlementReceiptLog[],
): boolean {
  if (signed.standard === "ERC4494_PERMIT_ATOMIC_BATCH") {
    return logs.some((log) => {
      if (!sameAddress(log.address, signed.authorization.collectionAddress)) return false;
      try {
        const decoded = decodeEventLog({
          abi: erc721TransferEventAbi,
          data: log.data,
          topics: [...log.topics] as [Hex, ...Hex[]],
        });
        return decoded.eventName === "Transfer" &&
          sameAddress(decoded.args.from, signed.authorization.owner) &&
          sameAddress(decoded.args.to, signed.authorization.spender) &&
          decoded.args.tokenId === signed.authorization.tokenId;
      } catch {
        return false;
      }
    });
  }

  const expected = signed.standard === "ERC3009_RECEIVE_WITH_AUTHORIZATION"
    ? {
        token: signed.authorization.tokenAddress,
        from: signed.authorization.from,
        to: signed.authorization.to,
        amount: BigInt(signed.authorization.value),
      }
    : signed.standard === "ERC2612_PERMIT_ATOMIC_BATCH"
      ? {
          token: signed.authorization.tokenAddress,
          from: signed.authorization.owner,
          to: signed.authorization.spender,
          amount: BigInt(signed.authorization.value),
        }
      : {
          token: signed.authorization.tokenAddress,
          from: signed.authorization.holder,
          to: signed.authorization.spender,
          amount: BigInt(signed.authorization.value),
        };

  return logs.some((log) => {
    if (!sameAddress(log.address, expected.token)) return false;
    try {
      const decoded = decodeEventLog({
        abi: erc20TransferEventAbi,
        data: log.data,
        topics: [...log.topics] as [Hex, ...Hex[]],
      });
      return decoded.eventName === "Transfer" &&
        sameAddress(decoded.args.from, expected.from) &&
        sameAddress(decoded.args.to, expected.to) &&
        decoded.args.value === expected.amount;
    } catch {
      return false;
    }
  });
}
