import {
  encodeFunctionData,
  getAddress,
  isAddress,
  parseSignature,
  recoverTypedDataAddress,
  type Hex,
} from "viem";

import {
  XLAYER_TESTNET_CHAIN_HEX,
  XLAYER_TESTNET_CHAIN_ID,
  type DaiPermitRescueAction,
  type Erc2612RescueAction,
  type Erc4494RescueAction,
  type GaslessRescueAction,
} from "./testnet-rescue";

export type OkxInjectedProvider = {
  request(request: { method: string; params?: readonly unknown[] }): Promise<unknown>;
  on?(event: "accountsChanged" | "chainChanged", listener: (...args: unknown[]) => void): void;
  removeListener?(
    event: "accountsChanged" | "chainChanged",
    listener: (...args: unknown[]) => void,
  ): void;
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

export function getOkxProvider(): OkxInjectedProvider {
  if (typeof window === "undefined" || !window.okxwallet) {
    throw new Error("OKX Wallet extension was not detected in this browser");
  }
  return window.okxwallet;
}

export async function connectOkxWallet(
  provider: OkxInjectedProvider,
): Promise<`0x${string}`> {
  return parseAccount(await provider.request({ method: "eth_requestAccounts" }));
}

export async function ensureXLayerTestnet(provider: OkxInjectedProvider): Promise<void> {
  const current = await provider.request({ method: "eth_chainId" });
  if (typeof current === "string" && current.toLowerCase() === XLAYER_TESTNET_CHAIN_HEX) {
    return;
  }

  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: XLAYER_TESTNET_CHAIN_HEX }],
    });
  } catch (error) {
    if (providerErrorCode(error) !== 4_902) {
      throw error;
    }
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: XLAYER_TESTNET_CHAIN_HEX,
          chainName: "X Layer testnet",
          nativeCurrency: { name: "OKB", symbol: "OKB", decimals: 18 },
          rpcUrls: [
            "https://testrpc.xlayer.tech/terigon",
            "https://xlayertestrpc.okx.com/terigon",
          ],
          blockExplorerUrls: ["https://www.okx.com/web3/explorer/xlayer-test"],
        },
      ],
    });
  }

  const selected = await provider.request({ method: "eth_chainId" });
  if (typeof selected !== "string" || selected.toLowerCase() !== XLAYER_TESTNET_CHAIN_HEX) {
    throw new Error("OKX Wallet is not connected to X Layer testnet");
  }
}

export function createEip3009Authorization(
  action: GaslessRescueAction,
  options: { now?: Date; nonce?: Hex } = {},
): Eip3009Authorization {
  if (action.standard !== "ERC3009_RECEIVE_WITH_AUTHORIZATION") {
    throw new Error("The action is not a verified ERC-3009 rescue action");
  }
  if (action.domain.chainId !== XLAYER_TESTNET_CHAIN_ID) {
    throw new Error("Only X Layer testnet authorizations are enabled");
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
    validBefore: now + 300n,
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
  if (action.domain.chainId !== XLAYER_TESTNET_CHAIN_ID) {
    throw new Error("Only X Layer testnet permit authorizations are enabled");
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
    deadline: now + 300n,
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
  if (action.domain.chainId !== XLAYER_TESTNET_CHAIN_ID) {
    throw new Error("Only X Layer testnet DAI-style permits are enabled");
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
    expiry: now + 300n,
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
  if (action.domain.chainId !== XLAYER_TESTNET_CHAIN_ID) {
    throw new Error("Only X Layer testnet NFT permit authorizations are enabled");
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
    deadline: now + 300n,
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
): Promise<void> {
  const result = await provider.request({
    method: "wallet_getCapabilities",
    params: [account, [XLAYER_TESTNET_CHAIN_HEX]],
  });
  if (!result || typeof result !== "object") {
    throw new Error("OKX Wallet did not return atomic batch capabilities");
  }
  const capabilities = Object.entries(result).find(
    ([chainId]) => chainId.toLowerCase() === XLAYER_TESTNET_CHAIN_HEX,
  )?.[1];
  const atomicStatus =
    capabilities && typeof capabilities === "object" && "atomic" in capabilities
      ? (capabilities.atomic as { status?: unknown }).status
      : undefined;
  if (atomicStatus !== "supported" && atomicStatus !== "ready") {
    throw new Error("OKX Wallet does not report atomic batch support on X Layer testnet");
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
  const now = BigInt(Math.floor(Date.now() / 1_000));
  if (now >= signed.authorization.deadline) {
    throw new Error("The source permit has expired; create a fresh permit");
  }
  const chainId = await provider.request({ method: "eth_chainId" });
  if (typeof chainId !== "string" || chainId.toLowerCase() !== XLAYER_TESTNET_CHAIN_HEX) {
    throw new Error("OKX Wallet is not connected to X Layer testnet");
  }
  await requireOkxAtomicBatchCapability(provider, connectedAccount);
  const result = await provider.request({
    method: "wallet_sendCalls",
    params: [{
      version: "2.0.0",
      from: connectedAccount,
      chainId: XLAYER_TESTNET_CHAIN_HEX,
      atomicRequired: true,
      calls: [
        { to: signed.authorization.tokenAddress, data: signed.permitData, value: "0x0" },
        { to: signed.authorization.tokenAddress, data: signed.transferFromData, value: "0x0" },
      ],
    }],
  });
  if (typeof result !== "string" || !/^0x[a-fA-F0-9]{2,512}$/.test(result)) {
    throw new Error("OKX Wallet did not return a valid atomic call identifier");
  }
  return result;
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
  const now = BigInt(Math.floor(Date.now() / 1_000));
  if (now >= signed.authorization.expiry) {
    throw new Error("The source DAI-style permits have expired; create fresh permits");
  }
  const chainId = await provider.request({ method: "eth_chainId" });
  if (typeof chainId !== "string" || chainId.toLowerCase() !== XLAYER_TESTNET_CHAIN_HEX) {
    throw new Error("OKX Wallet is not connected to X Layer testnet");
  }
  await requireOkxAtomicBatchCapability(provider, connectedAccount);
  const result = await provider.request({
    method: "wallet_sendCalls",
    params: [{
      version: "2.0.0",
      from: connectedAccount,
      chainId: XLAYER_TESTNET_CHAIN_HEX,
      atomicRequired: true,
      calls: [
        { to: signed.authorization.tokenAddress, data: signed.allowPermitData, value: "0x0" },
        { to: signed.authorization.tokenAddress, data: signed.transferFromData, value: "0x0" },
        { to: signed.authorization.tokenAddress, data: signed.revokePermitData, value: "0x0" },
      ],
    }],
  });
  if (typeof result !== "string" || !/^0x[a-fA-F0-9]{2,512}$/.test(result)) {
    throw new Error("OKX Wallet did not return a valid DAI-style atomic call identifier");
  }
  return result;
}

export async function submitErc4494AtomicBatch(
  provider: OkxInjectedProvider,
  signed: SignedErc4494Permit,
  connectedAccount: `0x${string}`,
): Promise<string> {
  if (connectedAccount.toLowerCase() !== signed.authorization.spender.toLowerCase()) {
    throw new Error("Only the designated safe destination can submit this NFT permit batch");
  }
  const now = BigInt(Math.floor(Date.now() / 1_000));
  if (now >= signed.authorization.deadline) {
    throw new Error("The source NFT permit has expired; create a fresh permit");
  }
  const chainId = await provider.request({ method: "eth_chainId" });
  if (typeof chainId !== "string" || chainId.toLowerCase() !== XLAYER_TESTNET_CHAIN_HEX) {
    throw new Error("OKX Wallet is not connected to X Layer testnet");
  }
  await requireOkxAtomicBatchCapability(provider, connectedAccount);
  const result = await provider.request({
    method: "wallet_sendCalls",
    params: [{
      version: "2.0.0",
      from: connectedAccount,
      chainId: XLAYER_TESTNET_CHAIN_HEX,
      atomicRequired: true,
      calls: [
        { to: signed.authorization.collectionAddress, data: signed.permitData, value: "0x0" },
        { to: signed.authorization.collectionAddress, data: signed.transferFromData, value: "0x0" },
      ],
    }],
  });
  if (typeof result !== "string" || !/^0x[a-fA-F0-9]{2,512}$/.test(result)) {
    throw new Error("OKX Wallet did not return a valid NFT atomic call identifier");
  }
  return result;
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
  const now = BigInt(Math.floor(Date.now() / 1_000));
  if (now <= signed.authorization.validAfter || now >= signed.authorization.validBefore) {
    throw new Error("The source authorization is not currently valid; create a fresh authorization");
  }
  const chainId = await provider.request({ method: "eth_chainId" });
  if (typeof chainId !== "string" || chainId.toLowerCase() !== XLAYER_TESTNET_CHAIN_HEX) {
    throw new Error("OKX Wallet is not connected to X Layer testnet");
  }
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
