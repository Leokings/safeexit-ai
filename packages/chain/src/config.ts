import { createPublicClient, defineChain, http, type Chain } from "viem";
import {
  arbitrum,
  avalanche,
  base,
  bsc,
  mainnet,
  optimism,
  polygon,
} from "viem/chains";

export type ChainEnvironment = "MAINNET" | "LOCAL";
export type ScannerCapabilitySupport = "SUPPORTED" | "UNSUPPORTED" | "UNKNOWN";

export type ScannerCapabilities = {
  nativeBalance: ScannerCapabilitySupport;
  erc20Assets: ScannerCapabilitySupport;
  erc721Assets: ScannerCapabilitySupport;
  erc1155Assets: ScannerCapabilitySupport;
  erc20Allowances: ScannerCapabilitySupport;
  nftOperatorApprovals: ScannerCapabilitySupport;
  permit2Approvals: ScannerCapabilitySupport;
};

export type ChainAdapterConfig = {
  id: string;
  environment: ChainEnvironment;
  chain: Chain;
  rpcUrls: readonly [string, ...string[]];
  scannerCapabilities: ScannerCapabilities;
  configurationSource: string;
};

const standardScannerCapabilities: ScannerCapabilities = {
  nativeBalance: "SUPPORTED",
  erc20Assets: "SUPPORTED",
  erc721Assets: "SUPPORTED",
  erc1155Assets: "SUPPORTED",
  erc20Allowances: "SUPPORTED",
  nftOperatorApprovals: "SUPPORTED",
  permit2Approvals: "UNKNOWN",
};

export const xLayerMainnet = defineChain({
  id: 196,
  name: "X Layer",
  nativeCurrency: {
    name: "OKB",
    symbol: "OKB",
    decimals: 18,
  },
  rpcUrls: {
    default: {
      http: ["https://rpc.xlayer.tech", "https://xlayerrpc.okx.com"],
    },
  },
  blockExplorers: {
    default: {
      name: "OKX Explorer",
      url: "https://www.okx.com/web3/explorer/xlayer",
    },
  },
});

export const anvilLocal = defineChain({
  id: 31_337,
  name: "Anvil Local",
  nativeCurrency: {
    name: "Test Ether",
    symbol: "ETH",
    decimals: 18,
  },
  rpcUrls: {
    default: {
      http: ["http://127.0.0.1:8545"],
    },
  },
  testnet: true,
});

const officialXLayerSource =
  "https://web3.okx.com/onchainos/dev-docs/xlayer/developer/build-on-xlayer/network-information";
const viemChainSource = "https://viem.sh/docs/chains/introduction";

function standardMainnetConfig(
  id: string,
  chain: Chain,
): ChainAdapterConfig {
  const publicRpc = chain.rpcUrls.default.http[0];
  if (!publicRpc) {
    throw new Error(`Chain ${chain.id} has no configured public RPC URL`);
  }
  return {
    id,
    environment: "MAINNET",
    chain,
    rpcUrls: [publicRpc],
    scannerCapabilities: standardScannerCapabilities,
    configurationSource: viemChainSource,
  };
}

export const ethereumMainnetConfig = standardMainnetConfig("ethereum-mainnet", mainnet);
export const bnbMainnetConfig = standardMainnetConfig("bnb-mainnet", bsc);
export const polygonMainnetConfig = standardMainnetConfig("polygon-mainnet", polygon);
export const arbitrumMainnetConfig = standardMainnetConfig("arbitrum-mainnet", arbitrum);
export const optimismMainnetConfig = standardMainnetConfig("optimism-mainnet", optimism);
export const baseMainnetConfig = standardMainnetConfig("base-mainnet", base);
export const avalancheMainnetConfig = standardMainnetConfig("avalanche-mainnet", avalanche);

export const xLayerMainnetConfig: ChainAdapterConfig = {
  id: "x-layer-mainnet",
  environment: "MAINNET",
  chain: xLayerMainnet,
  rpcUrls: ["https://rpc.xlayer.tech", "https://xlayerrpc.okx.com"],
  scannerCapabilities: standardScannerCapabilities,
  configurationSource: officialXLayerSource,
};

export const anvilLocalConfig: ChainAdapterConfig = {
  id: "anvil-local",
  environment: "LOCAL",
  chain: anvilLocal,
  rpcUrls: ["http://127.0.0.1:8545"],
  scannerCapabilities: {
    ...standardScannerCapabilities,
    permit2Approvals: "UNSUPPORTED",
  },
  configurationSource: "Local deterministic development configuration",
};

export const RESCUE_MAINNET_CHAIN_IDS = [
  1,
  56,
  137,
  42_161,
  10,
  8_453,
  43_114,
  196,
] as const;

export type RescueMainnetChainId = (typeof RESCUE_MAINNET_CHAIN_IDS)[number];

export type RescueFinalityPolicy = {
  chainId: RescueMainnetChainId;
  minimumConfirmations: number;
};

// SafeExit completion thresholds; these do not claim irreversible protocol finality.
// Receipt blocks must also remain canonical before and after final state verification.
const rescueFinalityPolicies: Record<RescueMainnetChainId, RescueFinalityPolicy> = {
  1: { chainId: 1, minimumConfirmations: 12 },
  56: { chainId: 56, minimumConfirmations: 20 },
  137: { chainId: 137, minimumConfirmations: 128 },
  42_161: { chainId: 42_161, minimumConfirmations: 64 },
  10: { chainId: 10, minimumConfirmations: 64 },
  8_453: { chainId: 8_453, minimumConfirmations: 64 },
  43_114: { chainId: 43_114, minimumConfirmations: 20 },
  196: { chainId: 196, minimumConfirmations: 64 },
};

export const rescueMainnetChainConfigs = [
  ethereumMainnetConfig,
  bnbMainnetConfig,
  polygonMainnetConfig,
  arbitrumMainnetConfig,
  optimismMainnetConfig,
  baseMainnetConfig,
  avalancheMainnetConfig,
  xLayerMainnetConfig,
] as const;

export const configuredChains = [
  ...rescueMainnetChainConfigs,
  anvilLocalConfig,
] as const;

export const primaryChainConfig = xLayerMainnetConfig;
export const defaultDevelopmentChainConfig = anvilLocalConfig;

export function isRescueMainnetChainId(
  chainId: number,
): chainId is RescueMainnetChainId {
  return (RESCUE_MAINNET_CHAIN_IDS as readonly number[]).includes(chainId);
}

export function getRescueMainnetChainConfig(
  chainId: number,
): ChainAdapterConfig {
  if (!isRescueMainnetChainId(chainId)) {
    throw new Error(`Unsupported rescue mainnet chain ID: ${chainId}`);
  }
  const config = rescueMainnetChainConfigs.find(
    (candidate) => candidate.chain.id === chainId,
  );
  if (!config) {
    throw new Error(`Missing rescue mainnet configuration for chain ${chainId}`);
  }
  return config;
}

export function getRescueFinalityPolicy(chainId: number): RescueFinalityPolicy {
  if (!isRescueMainnetChainId(chainId)) {
    throw new Error(`Unsupported rescue finality policy chain ID: ${chainId}`);
  }
  return rescueFinalityPolicies[chainId];
}

export function getChainAdapterConfig(chainId: number): ChainAdapterConfig {
  const config = configuredChains.find((candidate) => candidate.chain.id === chainId);

  if (!config) {
    throw new Error(`Unsupported chain ID: ${chainId}`);
  }

  return config;
}

export function createConfiguredPublicClient(
  config: ChainAdapterConfig,
  rpcUrl = config.rpcUrls[0],
) {
  if (!config.rpcUrls.includes(rpcUrl)) {
    throw new Error(`RPC URL is not configured for chain ${config.chain.id}`);
  }

  return createPublicClient({
    chain: config.chain,
    transport: http(rpcUrl),
  });
}

export function createDedicatedPublicClient(
  config: ChainAdapterConfig,
  rpcUrl: string,
) {
  const url = new URL(rpcUrl);
  if (config.environment !== "LOCAL" && url.protocol !== "https:") {
    throw new Error("Dedicated production RPC URLs must use HTTPS");
  }

  return createPublicClient({
    chain: config.chain,
    transport: http(url.toString(), { retryCount: 2, timeout: 10_000 }),
  });
}
