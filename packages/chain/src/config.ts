import { createPublicClient, defineChain, http, type Chain } from "viem";

export type ChainEnvironment = "MAINNET" | "TESTNET" | "LOCAL";
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

export const xLayerTestnet = defineChain({
  id: 1952,
  name: "X Layer Testnet",
  nativeCurrency: {
    name: "OKB",
    symbol: "OKB",
    decimals: 18,
  },
  rpcUrls: {
    default: {
      http: [
        "https://testrpc.xlayer.tech/terigon",
        "https://xlayertestrpc.okx.com/terigon",
      ],
    },
  },
  blockExplorers: {
    default: {
      name: "OKX Explorer",
      url: "https://www.okx.com/web3/explorer/xlayer-test",
    },
  },
  testnet: true,
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

export const xLayerMainnetConfig: ChainAdapterConfig = {
  id: "x-layer-mainnet",
  environment: "MAINNET",
  chain: xLayerMainnet,
  rpcUrls: ["https://rpc.xlayer.tech", "https://xlayerrpc.okx.com"],
  scannerCapabilities: standardScannerCapabilities,
  configurationSource: officialXLayerSource,
};

export const xLayerTestnetConfig: ChainAdapterConfig = {
  id: "x-layer-testnet",
  environment: "TESTNET",
  chain: xLayerTestnet,
  rpcUrls: [
    "https://testrpc.xlayer.tech/terigon",
    "https://xlayertestrpc.okx.com/terigon",
  ],
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

export const configuredChains = [
  xLayerMainnetConfig,
  xLayerTestnetConfig,
  anvilLocalConfig,
] as const;

export const primaryChainConfig = xLayerMainnetConfig;
export const defaultDevelopmentChainConfig = anvilLocalConfig;

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
