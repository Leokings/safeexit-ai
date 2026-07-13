import { createPublicClient, http } from "viem";

import type { DeploymentEnvironment } from "./deployment-env";

export type ConfiguredRpcEndpoint = {
  key: string;
  name: string;
  chainId: number;
  url: string;
  rescueSupport: "ENABLED" | "CONFIG_ONLY";
};

type RpcEndpointCandidate = Omit<ConfiguredRpcEndpoint, "url"> & {
  url: string | undefined;
};

export function getConfiguredRpcEndpoints(
  config: DeploymentEnvironment,
): ConfiguredRpcEndpoint[] {
  const candidates: RpcEndpointCandidate[] = [
    {
      key: "ethereum",
      name: "Ethereum",
      chainId: 1,
      url: config.ethereumMainnetRpcUrl,
      rescueSupport: "CONFIG_ONLY",
    },
    {
      key: "bnb",
      name: "BNB Smart Chain",
      chainId: 56,
      url: config.bnbMainnetRpcUrl,
      rescueSupport: "CONFIG_ONLY",
    },
    {
      key: "polygon",
      name: "Polygon",
      chainId: 137,
      url: config.polygonMainnetRpcUrl,
      rescueSupport: "CONFIG_ONLY",
    },
    {
      key: "arbitrum",
      name: "Arbitrum One",
      chainId: 42_161,
      url: config.arbitrumMainnetRpcUrl,
      rescueSupport: "CONFIG_ONLY",
    },
    {
      key: "optimism",
      name: "Optimism",
      chainId: 10,
      url: config.optimismMainnetRpcUrl,
      rescueSupport: "CONFIG_ONLY",
    },
    {
      key: "base",
      name: "Base",
      chainId: 8_453,
      url: config.baseMainnetRpcUrl,
      rescueSupport: "CONFIG_ONLY",
    },
    {
      key: "avalanche",
      name: "Avalanche C-Chain",
      chainId: 43_114,
      url: config.avalancheMainnetRpcUrl,
      rescueSupport: "CONFIG_ONLY",
    },
    {
      key: "x-layer",
      name: "X Layer (OKX)",
      chainId: 196,
      url: config.xLayerMainnetRpcUrl,
      rescueSupport: "ENABLED",
    },
  ];
  return candidates.flatMap<ConfiguredRpcEndpoint>((endpoint) =>
    endpoint.url ? [{ ...endpoint, url: endpoint.url }] : [],
  );
}

export async function probeConfiguredRpcEndpoints(
  config: DeploymentEnvironment,
): Promise<Record<string, string>> {
  const endpoints = getConfiguredRpcEndpoints(config);
  const probes = await Promise.all(endpoints.map(async (endpoint) => {
    const parsed = new URL(endpoint.url);
    if (parsed.protocol !== "https:") {
      throw new Error(`${endpoint.name} RPC must use HTTPS`);
    }
    const client = createPublicClient({
      transport: http(parsed.toString(), { retryCount: 1, timeout: 10_000 }),
    });
    const [reportedChainId, blockNumber] = await Promise.all([
      client.getChainId(),
      client.getBlockNumber(),
    ]);
    if (reportedChainId !== endpoint.chainId) {
      throw new Error(
        `${endpoint.name} RPC reported chain ${reportedChainId}; expected ${endpoint.chainId}`,
      );
    }
    return [
      `rpc.${endpoint.key}`,
      `connected:${reportedChainId}:${blockNumber.toString()}:${endpoint.rescueSupport}`,
    ] as const;
  }));
  return Object.fromEntries(probes);
}
