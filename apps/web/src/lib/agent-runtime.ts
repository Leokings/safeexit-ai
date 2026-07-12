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
  xLayerMainnetConfig,
} from "@safeexit/chain";
import {
  PrismaAgentServiceJobStore,
  getPrismaClient,
} from "@safeexit/persistence";
import {
  computePlanIntegrityHash,
  DeterministicRescuePlanner,
} from "@safeexit/planner";
import {
  DeterministicWalletScanner,
  ViemStandardReadClient,
} from "@safeexit/scanner";
import {
  rescuePlanSchema,
  simulationResultSchema,
  walletScanSchema,
  type Incident,
  type RescueAction,
  type RescuePlan,
  type WalletScan,
} from "@safeexit/shared";
import {
  LocalSimulationProvider,
  simulateRescuePlan,
  ViemLocalSimulationClient,
} from "@safeexit/simulator";
import type { Address } from "viem";

const erc20DecimalsAbi = [
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
] as const;

import { createDemoAiContext } from "./demo-ai-context";
import { demoIncident } from "./demo-incident";
import { parseDeploymentEnvironment } from "./deployment-env";

const replayGas: Record<RescueAction["actionType"], string> = {
  CLAIM_SUPPORTED_AIRDROP: "34873",
  TRANSFER_ERC20: "46803",
  TRANSFER_ERC721: "57872",
  REVOKE_ERC20_APPROVAL: "24394",
  TRANSFER_ERC1155: "0",
  REVOKE_NFT_OPERATOR: "0",
  WITHDRAW_SUPPORTED_POSITION: "0",
  CUSTOM_SUPPORTED_ADAPTER: "0",
  TRANSFER_NATIVE: "0",
};

function assertReplayScope(incident: Incident): void {
  if (
    incident.chainId !== demoIncident.chainId ||
    incident.sourceAddress.toLowerCase() !== demoIncident.source.toLowerCase() ||
    incident.destinationAddress.toLowerCase() !== demoIncident.destination.toLowerCase()
  ) {
    throw new Error(
      "Hosted replay supports only the fixed developer-created demo incident",
    );
  }
}

function scoped(scope: string, value: string): string {
  return `${value}:${scope}`.slice(0, 256);
}

class HostedReplayAnalyzer implements IncidentAnalyzerPort {
  async analyse(incident: Incident): Promise<WalletScan> {
    assertReplayScope(incident);
    const base = createDemoAiContext().scan;
    const evidenceIds = new Map<string, string>();
    for (const evidence of [...base.assets, ...base.approvals]) {
      evidenceIds.set(evidence.id, scoped(incident.id, evidence.id));
    }
    return walletScanSchema.parse({
      ...base,
      id: scoped(incident.id, "scan"),
      incidentId: incident.id,
      address: incident.sourceAddress,
      providerId: "safeexit-hosted-replay-v1",
      assets: base.assets.map((asset) => ({
        ...asset,
        id: evidenceIds.get(asset.id),
        ownerAddress: incident.sourceAddress,
      })),
      approvals: base.approvals.map((approval) => ({
        ...approval,
        id: evidenceIds.get(approval.id),
        ownerAddress: incident.sourceAddress,
      })),
      warnings: [
        "Hosted replay fixture only; this is not a live production-chain discovery result.",
      ],
    });
  }
}

class HostedReplayPlanner implements RescuePlanGeneratorPort {
  async generate(incident: Incident, scan: WalletScan): Promise<RescuePlan> {
    assertReplayScope(incident);
    const base = createDemoAiContext().plan;
    if (!base) {
      throw new Error("Hosted replay plan is unavailable");
    }

    const evidenceMap = new Map<string, string>([
      ["asset:srt", scan.assets.find((asset) => asset.assetType === "ERC20")?.id ?? ""],
      ["asset:nft:1", scan.assets.find((asset) => asset.assetType === "ERC721")?.id ?? ""],
      ["approval:demo-attacker", scan.approvals[0]?.id ?? ""],
      ["claim:srt", scoped(incident.id, "claim:srt")],
    ]);
    const actionMap = new Map(
      base.actions.map((action) => [action.id, scoped(incident.id, action.id)]),
    );
    const actions = base.actions.map((action) => ({
      ...action,
      id: actionMap.get(action.id),
      sourceAddress: incident.sourceAddress,
      dependencies: action.dependencies.map((id) => actionMap.get(id)),
      evidenceIds: action.evidenceIds.map((id) => evidenceMap.get(id)),
      expectedEffects: action.expectedEffects.map((effect) => ({
        ...effect,
        ...(effect.assetId ? { assetId: evidenceMap.get(effect.assetId) } : {}),
      })),
      parameters:
        "recipient" in action.parameters
          ? { ...action.parameters, recipient: incident.destinationAddress }
          : action.parameters,
    }));
    const payload: Omit<RescuePlan, "integrityHash"> = {
      ...base,
      id: scoped(incident.id, "plan"),
      incidentId: incident.id,
      sourceAddress: incident.sourceAddress,
      destinationAddress: incident.destinationAddress,
      actions: rescuePlanSchema.shape.actions.parse(actions),
      createdAt: new Date().toISOString(),
    };
    return rescuePlanSchema.parse({
      ...payload,
      integrityHash: computePlanIntegrityHash(payload),
    });
  }
}

class HostedReplaySimulator implements RescuePlanSimulatorPort {
  async simulate(plan: RescuePlan): Promise<AgentSimulationReport> {
    const simulatedAt = new Date();
    const expiresAt = new Date(simulatedAt.getTime() + 5 * 60_000);
    const results = plan.actions.map((action, index) =>
      simulationResultSchema.parse({
        id: scoped(plan.id, `simulation:${index + 1}`),
        planId: plan.id,
        actionId: action.id,
        providerId: "safeexit-hosted-replay-v1",
        status: "SUCCEEDED",
        planHash: plan.integrityHash,
        observedAtBlock: plan.observedAtBlock,
        gasEstimate: replayGas[action.actionType],
        expectedEffects: action.expectedEffects,
        assetChanges: [],
        warnings: [
          "Verified fixture replay only; no production simulation provider was called.",
        ],
        simulatedAt: simulatedAt.toISOString(),
        expiresAt: expiresAt.toISOString(),
      }),
    );
    return {
      status: "SUCCEEDED",
      providerId: "safeexit-hosted-replay-v1",
      results,
      executableActionIds: plan.actions.map((action) => action.id),
      excludedActionIds: [],
    };
  }
}

class LiveXLayerAnalyzer implements IncidentAnalyzerPort {
  private readonly discovery: OkxWalletBalanceDiscoveryClient;

  constructor(private readonly rpcUrl: string, credentials: {
    apiKey: string;
    secretKey: string;
    passphrase: string;
  }) {
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
          const decimals = await client.readContract({
            address: candidate.tokenAddress as Address,
            abi: erc20DecimalsAbi,
            functionName: "decimals",
            blockNumber: observedAtBlock,
          });
          return {
            candidate,
            query: {
              tokenAddress: candidate.tokenAddress,
              name: candidate.symbol,
              symbol: candidate.symbol.slice(0, 32),
              decimals,
            },
          };
        } catch {
          return { candidate };
        }
      }),
    );
    const manifestTokens = metadata.flatMap((entry) =>
      "query" in entry && entry.query ? [entry.query] : [],
    );
    const metadataFailures = metadata.filter((entry) => !("query" in entry)).length;
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
      manifest: { erc20Assets: manifestTokens },
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
  constructor(private readonly rpcUrl: string) {}

  async simulate(plan: RescuePlan): Promise<AgentSimulationReport> {
    if (plan.chainId !== xLayerMainnetConfig.chain.id) {
      throw new Error("Live RPC preflight currently supports X Layer mainnet only");
    }
    const publicClient = createDedicatedPublicClient(xLayerMainnetConfig, this.rpcUrl);
    const client = new ViemLocalSimulationClient(
      "x-layer-mainnet-rpc-preflight-client",
      publicClient,
    );
    const provider = new LocalSimulationProvider({
      id: "x-layer-mainnet-rpc-preflight-v1",
      kind: "PRODUCTION_RPC",
      client,
      ttlMs: 60_000,
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
      detail: "Hosted execution is disabled; user-controlled signing is not connected.",
    };
  }
}

class ScopedDashboardLocator implements DashboardLocatorPort {
  constructor(private readonly baseUrl: string) {}

  getDashboardUrl(job: Parameters<DashboardLocatorPort["getDashboardUrl"]>[0]): string {
    const url = new URL("/demo", this.baseUrl);
    url.searchParams.set("job", job.id);
    return url.toString();
  }
}

class LiveDashboardLocator implements DashboardLocatorPort {
  constructor(private readonly baseUrl: string) {}

  getDashboardUrl(job: Parameters<DashboardLocatorPort["getDashboardUrl"]>[0]): string {
    return new URL(`/rescue/${encodeURIComponent(job.id)}`, this.baseUrl).toString();
  }
}

const globalAgentRuntime = globalThis as typeof globalThis & {
  safeExitAgentService?: AgentIncidentService;
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

export function getAgentIncidentService(): AgentIncidentService {
  const config = parseDeploymentEnvironment();
  if (config.agentMode === "DISABLED") {
    throw new Error("SAFEEXIT agent service is disabled for this deployment");
  }
  if (config.agentMode === "LIVE_READONLY") {
    if (
      !config.okxWeb3ApiKey ||
      !config.okxWeb3SecretKey ||
      !config.okxWeb3Passphrase ||
      !config.xLayerMainnetRpcUrl
    ) {
      throw new Error("Live SAFEEXIT dependencies are not configured");
    }
    globalAgentRuntime.safeExitAgentService ??= new AgentIncidentService({
      store: createStore(),
      analyzer: new LiveXLayerAnalyzer(config.xLayerMainnetRpcUrl, {
        apiKey: config.okxWeb3ApiKey,
        secretKey: config.okxWeb3SecretKey,
        passphrase: config.okxWeb3Passphrase,
      }),
      planner: new LiveDeterministicPlanner(),
      simulator: new LiveRpcSimulator(config.xLayerMainnetRpcUrl),
      dashboard: new LiveDashboardLocator(config.publicBaseUrl),
      monitor: new ReviewOnlyMonitor(),
    });
  } else {
    globalAgentRuntime.safeExitAgentService ??= new AgentIncidentService({
      store: createStore(),
      analyzer: new HostedReplayAnalyzer(),
      planner: new HostedReplayPlanner(),
      simulator: new HostedReplaySimulator(),
      dashboard: new ScopedDashboardLocator(config.publicBaseUrl),
      monitor: new ReviewOnlyMonitor(),
    });
  }
  return globalAgentRuntime.safeExitAgentService;
}
