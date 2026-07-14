import { createPublicClient, http, zeroAddress } from "viem";

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
      rescueSupport: "ENABLED",
    },
    {
      key: "bnb",
      name: "BNB Smart Chain",
      chainId: 56,
      url: config.bnbMainnetRpcUrl,
      rescueSupport: "ENABLED",
    },
    {
      key: "polygon",
      name: "Polygon",
      chainId: 137,
      url: config.polygonMainnetRpcUrl,
      rescueSupport: "ENABLED",
    },
    {
      key: "arbitrum",
      name: "Arbitrum One",
      chainId: 42_161,
      url: config.arbitrumMainnetRpcUrl,
      rescueSupport: "ENABLED",
    },
    {
      key: "optimism",
      name: "Optimism",
      chainId: 10,
      url: config.optimismMainnetRpcUrl,
      rescueSupport: "ENABLED",
    },
    {
      key: "base",
      name: "Base",
      chainId: 8_453,
      url: config.baseMainnetRpcUrl,
      rescueSupport: "ENABLED",
    },
    {
      key: "avalanche",
      name: "Avalanche C-Chain",
      chainId: 43_114,
      url: config.avalancheMainnetRpcUrl,
      rescueSupport: "ENABLED",
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
    const reportedChainId = await client.getChainId();
    if (reportedChainId !== endpoint.chainId) {
      throw new Error(
        `${endpoint.name} RPC reported chain ${reportedChainId}; expected ${endpoint.chainId}`,
      );
    }
    const blockNumber = await client.getBlockNumber();
    const [block, balance, transactionCount, code, callResult] = await Promise.all([
      client.getBlock({ blockNumber }),
      client.getBalance({ address: zeroAddress, blockNumber }),
      client.getTransactionCount({ address: zeroAddress, blockNumber }),
      client.getCode({ address: zeroAddress, blockNumber }),
      client.call({ to: zeroAddress, data: "0x", blockNumber }),
    ]);
    if (
      block.number !== blockNumber ||
      balance < 0n ||
      transactionCount < 0 ||
      (code !== undefined && !code.startsWith("0x")) ||
      (callResult.data !== undefined && !callResult.data.startsWith("0x"))
    ) {
      throw new Error(`${endpoint.name} RPC failed deterministic EVM read checks`);
    }
    return [
      `rpc.${endpoint.key}`,
      `connected:${reportedChainId}:${blockNumber.toString()}:${endpoint.rescueSupport}`,
    ] as const;
  }));
  return Object.fromEntries(probes);
}
