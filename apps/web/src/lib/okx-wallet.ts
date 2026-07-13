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
  authorization: Eip3009Authorization;
  signature: Hex;
  settlementData: Hex;
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
  assertSignature(signature);
  const parsed = parseSignature(signature);
  const v = parsed.v ?? BigInt((parsed.yParity ?? 0) + 27);
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
      Number(v),
      parsed.r,
      parsed.s,
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
    authorization,
    signature: result,
    settlementData: encodeEip3009Settlement(authorization, result),
  };
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
