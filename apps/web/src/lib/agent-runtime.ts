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
import {
  PrismaAgentServiceJobStore,
  getPrismaClient,
} from "@safeexit/persistence";
import { computePlanIntegrityHash } from "@safeexit/planner";
import {
  rescuePlanSchema,
  simulationResultSchema,
  walletScanSchema,
  type Incident,
  type RescueAction,
  type RescuePlan,
  type WalletScan,
} from "@safeexit/shared";

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
  if (config.agentMode !== "HOSTED_REPLAY") {
    throw new Error("SAFEEXIT agent service is disabled for this deployment");
  }
  globalAgentRuntime.safeExitAgentService ??= new AgentIncidentService({
    store: createStore(),
    analyzer: new HostedReplayAnalyzer(),
    planner: new HostedReplayPlanner(),
    simulator: new HostedReplaySimulator(),
    dashboard: new ScopedDashboardLocator(config.publicBaseUrl),
    monitor: new ReviewOnlyMonitor(),
  });
  return globalAgentRuntime.safeExitAgentService;
}
