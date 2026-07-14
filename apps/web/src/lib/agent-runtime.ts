import {
  AgentIncidentService,
  InMemoryAgentServiceJobStore,
  type AgentServiceJobStore,
  type DashboardLocatorPort,
  type AgentSimulationReport,
  type IncidentAnalyzerPort,
  type RescueMonitorPort,
  type RescuePlanGeneratorPort,
  type RescuePlanSimulatorPort,
} from "@safeexit/agent-service";
import { OkxWalletBalanceDiscoveryClient } from "@safeexit/adapters";
import {
  createDedicatedPublicClient,
  type ChainAdapterConfig,
  xLayerMainnetConfig,
} from "@safeexit/chain";
import type { OkxA2AAssetManifest } from "@safeexit/okx-transport";
import {
  PrismaAgentServiceJobStore,
  getPrismaClient,
} from "@safeexit/persistence";
import {
  DeterministicRescuePlanner,
} from "@safeexit/planner";
import {
  DeterministicWalletScanner,
  ViemStandardReadClient,
} from "@safeexit/scanner";
import {
  walletScanSchema,
  type Incident,
  type RescuePlan,
  type WalletScan,
} from "@safeexit/shared";
import {
  LocalSimulationProvider,
  simulateRescuePlan,
  ViemLocalSimulationClient,
} from "@safeexit/simulator";
import type { Address } from "viem";

const erc20MetadataAbi = [
  {
    type: "function",
    name: "name",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
  },
  {
    type: "function",
    name: "symbol",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
  },
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
] as const;

const erc721MetadataAbi = [
  {
    type: "function",
    name: "name",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
  },
] as const;

function safeOnchainMetadata(value: string, maximum: number, fallback: string): string {
  const normalized = value.replace(/[\u0000-\u001F\u007F]/g, "").trim().slice(0, maximum);
  return normalized || fallback;
}

import { parseDeploymentEnvironment } from "./deployment-env";
import { LivePermitSigningPackageBuilder } from "./live-signing-package-builder";
import { LiveBuyerExecutionVerifier } from "./live-buyer-report-verifier";

class LiveXLayerAnalyzer implements IncidentAnalyzerPort {
  private readonly discovery: OkxWalletBalanceDiscoveryClient;

  constructor(
    private readonly rpcUrl: string,
    credentials: {
      apiKey: string;
      secretKey: string;
      passphrase: string;
    },
    private readonly manifest?: OkxA2AAssetManifest,
  ) {
    this.discovery = new OkxWalletBalanceDiscoveryClient(
      credentials,
      async (request) => {
        const response = await fetch(request.url, {
          method: "GET",
          headers: { ...request.headers },
          cache: "no-store",
          signal: AbortSignal.timeout(10_000),
        });
        return {
          ok: response.ok,
          status: response.status,
          json: () => response.json(),
        };
      },
    );
  }

  async analyse(incident: Incident): Promise<WalletScan> {
    if (incident.chainId !== xLayerMainnetConfig.chain.id) {
      throw new Error("Live discovery currently supports X Layer mainnet only");
    }

    const client = createDedicatedPublicClient(xLayerMainnetConfig, this.rpcUrl);
    const observedAtBlock = await client.getBlockNumber();
    const discovered = await this.discovery.discoverErc20Tokens(
      incident.sourceAddress,
      incident.chainId,
    );
    const uniqueCandidates = [
      ...new Map(
        discovered.map((candidate) => [candidate.tokenAddress.toLowerCase(), candidate]),
      ).values(),
    ];
    const selectedCandidates = uniqueCandidates.slice(0, 50);
    const metadata = await Promise.all(
      selectedCandidates.map(async (candidate) => {
        try {
          const address = candidate.tokenAddress as Address;
          const [name, symbol, decimals] = await Promise.all([
            client.readContract({
              address,
              abi: erc20MetadataAbi,
              functionName: "name",
              blockNumber: observedAtBlock,
            }).catch(() => candidate.symbol),
            client.readContract({
              address,
              abi: erc20MetadataAbi,
              functionName: "symbol",
              blockNumber: observedAtBlock,
            }).catch(() => candidate.symbol),
            client.readContract({
              address,
              abi: erc20MetadataAbi,
              functionName: "decimals",
              blockNumber: observedAtBlock,
            }),
          ]);
          return {
            candidate,
            query: {
              tokenAddress: candidate.tokenAddress,
              name: safeOnchainMetadata(name, 128, candidate.symbol),
              symbol: safeOnchainMetadata(symbol, 32, candidate.symbol.slice(0, 32)),
              decimals,
            },
          };
        } catch {
          return { candidate };
        }
      }),
    );
    const discoveredAddresses = new Set(
      selectedCandidates.map((candidate) => candidate.tokenAddress.toLowerCase()),
    );
    const explicitTokenMetadata = await Promise.all(
      (this.manifest?.erc20TokenAddresses ?? [])
        .filter((address) => !discoveredAddresses.has(address.toLowerCase()))
        .map(async (tokenAddress) => {
          try {
            const address = tokenAddress as Address;
            const bytecode = await client.getCode({ address, blockNumber: observedAtBlock });
            if (!bytecode) {
              throw new Error("No bytecode");
            }
            const [name, symbol, decimals] = await Promise.all([
              client.readContract({
                address,
                abi: erc20MetadataAbi,
                functionName: "name",
                blockNumber: observedAtBlock,
              }),
              client.readContract({
                address,
                abi: erc20MetadataAbi,
                functionName: "symbol",
                blockNumber: observedAtBlock,
              }),
              client.readContract({
                address,
                abi: erc20MetadataAbi,
                functionName: "decimals",
                blockNumber: observedAtBlock,
              }),
            ]);
            return {
              query: {
                tokenAddress,
                name: safeOnchainMetadata(name, 128, "Unlabelled ERC-20"),
                symbol: safeOnchainMetadata(symbol, 32, "TOKEN"),
                decimals,
              },
            } as const;
          } catch {
            return { tokenAddress, omitted: true } as const;
          }
        }),
    );
    const manifestTokens = [
      ...metadata.flatMap((entry) =>
        "query" in entry && entry.query ? [entry.query] : [],
      ),
      ...explicitTokenMetadata.flatMap((entry) =>
        "query" in entry ? [entry.query] : [],
      ),
    ];
    const explicitNftMetadata = await Promise.all(
      (this.manifest?.erc721Assets ?? []).map(async (asset) => {
        try {
          const address = asset.collectionAddress as Address;
          const bytecode = await client.getCode({ address, blockNumber: observedAtBlock });
          if (!bytecode) {
            throw new Error("No bytecode");
          }
          const name = await client.readContract({
            address,
            abi: erc721MetadataAbi,
            functionName: "name",
            blockNumber: observedAtBlock,
          }).catch(() => "Unlabelled ERC-721");
          return {
            query: {
              collectionAddress: asset.collectionAddress,
              tokenId: BigInt(asset.tokenId),
              name: safeOnchainMetadata(name, 128, "Unlabelled ERC-721"),
            },
          } as const;
        } catch {
          return { asset, omitted: true } as const;
        }
      }),
    );
    const explicitErc1155Metadata = await Promise.all(
      (this.manifest?.erc1155Assets ?? []).map(async (asset) => {
        const address = asset.collectionAddress as Address;
        const bytecode = await client.getCode({ address, blockNumber: observedAtBlock });
        return bytecode
          ? {
              query: {
                collectionAddress: asset.collectionAddress,
                tokenId: BigInt(asset.tokenId),
              },
            } as const
          : { asset, omitted: true } as const;
      }),
    );
    const metadataFailures =
      metadata.filter((entry) => !("query" in entry)).length +
      explicitTokenMetadata.filter((entry) => !("query" in entry)).length +
      explicitNftMetadata.filter((entry) => !("query" in entry)).length +
      explicitErc1155Metadata.filter((entry) => !("query" in entry)).length;
    const reader = new ViemStandardReadClient("x-layer-mainnet-rpc", client);
    const scanner = new DeterministicWalletScanner({
      config: xLayerMainnetConfig,
      reader,
    });
    const report = await scanner.scan({
      incidentId: incident.id,
      chainId: incident.chainId,
      address: incident.sourceAddress,
      observedAtBlock,
      manifest: {
        erc20Assets: manifestTokens,
        erc721Assets: explicitNftMetadata.flatMap((entry) =>
          "query" in entry ? [entry.query] : [],
        ),
        erc1155Assets: explicitErc1155Metadata.flatMap((entry) =>
          "query" in entry ? [entry.query] : [],
        ),
      },
    });
    const candidateByAddress = new Map(
      selectedCandidates.map((candidate) => [
        candidate.tokenAddress.toLowerCase(),
        candidate,
      ]),
    );
    const valuedAssets = report.scan.assets.map((asset) => {
      if (asset.assetType !== "ERC20") {
        return asset;
      }
      const candidate = candidateByAddress.get(asset.contractAddress.toLowerCase());
      const estimatedValueUsd =
        candidate?.tokenPriceUsd !== undefined
          ? Number(candidate.displayBalance) * candidate.tokenPriceUsd
          : undefined;
      return estimatedValueUsd !== undefined && Number.isFinite(estimatedValueUsd)
        ? {
            ...asset,
            valuation: {
              estimatedValueUsd,
              source: "OKX Wallet API token price",
              observedAt: report.scan.observedAt,
            },
          }
        : asset;
    });

    return walletScanSchema.parse({
      ...report.scan,
      status: "PARTIAL",
      providerId: "safeexit-live-xlayer-v1",
      assets: valuedAssets,
      warnings: [
        ...report.scan.warnings,
        "ERC-20 candidates were discovered by the official OKX Wallet API and balances were re-verified at the pinned RPC block.",
        "Explicit incident asset contracts were merged with discovery and re-verified at the pinned RPC block.",
        "NFT, allowance, operator-approval, Permit2, airdrop, and protocol-position discovery is not exhaustive in this release.",
        ...(uniqueCandidates.length > selectedCandidates.length
          ? ["Token discovery was capped at 50 candidates for this incident."]
          : []),
        ...(metadataFailures > 0
          ? [`${metadataFailures} token candidate(s) were omitted because standard metadata reads failed.`]
          : []),
      ],
    });
  }
}

class LiveDeterministicPlanner implements RescuePlanGeneratorPort {
  private readonly planner = new DeterministicRescuePlanner();

  async generate(incident: Incident, scan: WalletScan): Promise<RescuePlan> {
    return this.planner.plan({
      incidentId: incident.id,
      destinationAddress: incident.destinationAddress,
      policyVersion: "safeexit-live-standard-v1",
      scan,
      adapterCandidates: [],
    });
  }
}

class LiveRpcSimulator implements RescuePlanSimulatorPort {
  constructor(
    private readonly chain: ChainAdapterConfig,
    private readonly rpcUrl: string,
  ) {}

  async simulate(plan: RescuePlan): Promise<AgentSimulationReport> {
    if (plan.chainId !== this.chain.chain.id) {
      throw new Error("Live RPC preflight is not configured for this plan chain");
    }
    const publicClient = createDedicatedPublicClient(this.chain, this.rpcUrl);
    const client = new ViemLocalSimulationClient(
      `${this.chain.id}-rpc-preflight-client`,
      publicClient,
    );
    const provider = new LocalSimulationProvider({
      id: `${this.chain.id}-rpc-preflight-v1`,
      kind: this.chain.environment === "MAINNET" ? "PRODUCTION_RPC" : "TEST_RPC",
      client,
      ttlMs: 300_000,
    });
    const report = await simulateRescuePlan(plan, provider);
    return {
      status: report.status,
      providerId: report.providerId,
      results: [...report.results],
      executableActionIds: report.executableActions.map((action) => action.id),
      excludedActionIds: report.excludedActions.map((action) => action.actionId),
    };
  }
}

class ReviewOnlyMonitor implements RescueMonitorPort {
  async observe() {
    return {
      phase: "WAITING_FOR_USER" as const,
      completedActionIds: [],
      failedActionIds: [],
      transactionHashes: [],
      observedAt: new Date().toISOString(),
      detail: "Provider-side execution is disabled; signing and settlement stay buyer-controlled.",
    };
  }
}

class LiveDashboardLocator implements DashboardLocatorPort {
  constructor(private readonly baseUrl: string) {}

  getDashboardUrl(job: Parameters<DashboardLocatorPort["getDashboardUrl"]>[0]): string {
    return new URL(`/rescue/${encodeURIComponent(job.id)}`, this.baseUrl).toString();
  }
}

const globalAgentRuntime = globalThis as typeof globalThis & {
  safeExitMemoryStore?: InMemoryAgentServiceJobStore;
};

function createStore(): AgentServiceJobStore {
  const config = parseDeploymentEnvironment();
  if (config.agentStore === "DATABASE") {
    return new PrismaAgentServiceJobStore(getPrismaClient());
  }
  globalAgentRuntime.safeExitMemoryStore ??= new InMemoryAgentServiceJobStore();
  return globalAgentRuntime.safeExitMemoryStore;
}

export type AgentRuntimeRequest = {
  chainId?: number;
  assetManifest?: OkxA2AAssetManifest;
};

function createMainnetService(
  config: ReturnType<typeof parseDeploymentEnvironment>,
  assetManifest?: OkxA2AAssetManifest,
): AgentIncidentService {
  if (
    !config.okxWeb3ApiKey ||
    !config.okxWeb3SecretKey ||
    !config.okxWeb3Passphrase ||
    !config.xLayerMainnetRpcUrl
  ) {
    throw new Error("Live X Layer mainnet dependencies are not configured");
  }
  return new AgentIncidentService({
    store: createStore(),
    analyzer: new LiveXLayerAnalyzer(config.xLayerMainnetRpcUrl, {
      apiKey: config.okxWeb3ApiKey,
      secretKey: config.okxWeb3SecretKey,
      passphrase: config.okxWeb3Passphrase,
    }, assetManifest),
    planner: new LiveDeterministicPlanner(),
    simulator: new LiveRpcSimulator(xLayerMainnetConfig, config.xLayerMainnetRpcUrl),
    dashboard: new LiveDashboardLocator(config.publicBaseUrl),
    signingPackages: new LivePermitSigningPackageBuilder(
      xLayerMainnetConfig,
      config.xLayerMainnetRpcUrl,
    ),
    executionVerifier: new LiveBuyerExecutionVerifier(
      xLayerMainnetConfig,
      config.xLayerMainnetRpcUrl,
    ),
    monitor: new ReviewOnlyMonitor(),
  });
}

export function getAgentIncidentService(
  request: AgentRuntimeRequest = {},
): AgentIncidentService {
  const config = parseDeploymentEnvironment();
  if (config.agentMode !== "LIVE_READONLY") {
    throw new Error("SAFEEXIT agent service is disabled for this deployment");
  }
  const chainId = request.chainId ?? xLayerMainnetConfig.chain.id;
  if (chainId === xLayerMainnetConfig.chain.id) {
    return createMainnetService(config, request.assetManifest);
  }
  throw new Error(`Live SAFEEXIT does not support chain ${chainId}`);
}
