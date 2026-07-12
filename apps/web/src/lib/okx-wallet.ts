import { getAddress, isAddress, type Hex } from "viem";

import type { PreparedWalletTransaction } from "@safeexit/execution";

import {
  XLAYER_TESTNET_CHAIN_HEX,
  XLAYER_TESTNET_CHAIN_ID,
} from "./testnet-rescue";

export type OkxInjectedProvider = {
  request(request: { method: string; params?: readonly unknown[] }): Promise<unknown>;
  on?(event: "accountsChanged" | "chainChanged", listener: (...args: unknown[]) => void): void;
  removeListener?(
    event: "accountsChanged" | "chainChanged",
    listener: (...args: unknown[]) => void,
  ): void;
};

declare global {
  interface Window {
    okxwallet?: OkxInjectedProvider;
  }
}

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

export async function sendPreparedTestnetTransaction(
  provider: OkxInjectedProvider,
  transaction: PreparedWalletTransaction,
  connectedAccount: `0x${string}`,
): Promise<Hex> {
  if (transaction.chainId !== XLAYER_TESTNET_CHAIN_ID) {
    throw new Error("Only X Layer testnet transactions can be signed in this pilot");
  }
  if (transaction.from.toLowerCase() !== connectedAccount.toLowerCase()) {
    throw new Error("Connected account does not match the transaction source");
  }
  const result = await provider.request({
    method: "eth_sendTransaction",
    params: [
      {
        from: connectedAccount,
        to: transaction.to,
        value: transaction.value,
        ...(transaction.data ? { data: transaction.data } : {}),
      },
    ],
  });
  if (typeof result !== "string" || !/^0x[a-fA-F0-9]{64}$/.test(result)) {
    throw new Error("OKX Wallet did not return a valid transaction hash");
  }
  return result as Hex;
}
