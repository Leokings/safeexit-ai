import { createHash, randomUUID } from "node:crypto";

import {
  agentServiceJobSchema,
  signingPackageExecutionMetadata,
  signingPackageListSchema,
  type SigningPackage,
  type AgentServiceJob,
} from "@safeexit/agent-service";
import { RESCUE_MAINNET_CHAIN_IDS } from "@safeexit/chain";
import { incidentSchema } from "@safeexit/shared";

import {
  okxA2ABuyerReportRequestSchema,
  okxA2ACompletionDeliverableSchema,
  okxA2ASigningDeliverableSchema,
  okxA2ATaskRequestSchema,
  okxX402PrepareRequestSchema,
  okxX402RefreshRequestSchema,
  okxX402SigningDeliverableSchema,
  type OkxA2ABuyerReportRequest,
  type OkxA2ACompletionDeliverable,
  type OkxA2ASigningDeliverable,
  type OkxA2ATaskRequest,
  type OkxX402PrepareRequest,
  type OkxX402RefreshRequest,
  type OkxX402SigningDeliverable,
} from "./contracts";
import type { SafeExitAgentLifecyclePort } from "./ports";

function sameAddress(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function requestIdFor(providerAgentId: string, okxJobId: string): string {
  return `okx:${providerAgentId}:${okxJobId}`;
}

function statementVersionFor(request: OkxA2ATaskRequest): string {
  if (!request.assetManifest) {
    return "safeexit-okx-a2a-auth-v1";
  }
  const canonicalAddresses = [
    ...request.assetManifest.erc20TokenAddresses.map(
      (address) => `erc20:${address.toLowerCase()}`,
    ),
    ...request.assetManifest.erc721Assets.map(
      (asset) => `erc721:${asset.collectionAddress.toLowerCase()}:${asset.tokenId}`,
    ),
    ...request.assetManifest.erc1155Assets.map(
      (asset) => `erc1155:${asset.collectionAddress.toLowerCase()}:${asset.tokenId}`,
    ),
  ].sort();
  const commitment = createHash("sha256")
    .update(JSON.stringify(canonicalAddresses))
    .digest("hex")
    .slice(0, 7);
  return `safeexit-okx-a2a-auth-v1-${commitment}`;
}

export class OkxProviderBridgeError extends Error {
  constructor(
    readonly code: "HANDOFF_SCOPE_MISMATCH" | "JOB_NOT_READY" | "VERIFICATION_FAILED",
    message: string,
  ) {
    super(message);
    this.name = "OkxProviderBridgeError";
  }
}

function assertProvider(expected: string, actual: string): void {
  if (expected !== actual) {
    throw new OkxProviderBridgeError(
      "HANDOFF_SCOPE_MISMATCH",
      "The normalized task does not target this SAFEEXIT provider agent",
    );
  }
}

function assertSigningScope(
  request: OkxA2ATaskRequest,
  job: AgentServiceJob,
  signingPackage: SigningPackage,
): void {
  const isRequestedAsset = signingPackage.route === "ERC4494_PERMIT_SETTLEMENT"
    ? request.assetManifest.erc721Assets.some(
      (asset) =>
        sameAddress(asset.collectionAddress, signingPackage.collectionAddress) &&
        asset.tokenId === signingPackage.tokenId,
    )
    : request.assetManifest.erc20TokenAddresses.some((address) =>
      sameAddress(address, signingPackage.tokenAddress),
    );
  if (
    signingPackage.jobId !== job.id ||
    !job.plan?.actions.some((action) => action.id === signingPackage.actionId) ||
    !job.simulation?.executableActionIds.includes(signingPackage.actionId) ||
    signingPackage.chainId !== request.walletContext.chainId ||
    !sameAddress(signingPackage.sourceAddress, request.walletContext.sourceAddress) ||
    !sameAddress(signingPackage.destinationAddress, request.walletContext.destinationAddress) ||
    !isRequestedAsset
  ) {
    throw new OkxProviderBridgeError(
      "HANDOFF_SCOPE_MISMATCH",
      "SAFEEXIT returned a signing package outside the normalized task scope",
    );
  }
}

function assertPersistedSigningScope(
  job: AgentServiceJob,
  signingPackage: SigningPackage,
): void {
  const manifest = job.incident?.assetManifest;
  const isRequestedAsset = signingPackage.route === "ERC4494_PERMIT_SETTLEMENT"
    ? manifest?.erc721Assets.some(
      (asset) =>
        sameAddress(asset.collectionAddress, signingPackage.collectionAddress) &&
        asset.tokenId === signingPackage.tokenId,
    ) === true
    : manifest?.erc20TokenAddresses.some((address) =>
      sameAddress(address, signingPackage.tokenAddress),
    ) === true;
  if (
    !job.incident ||
    !job.plan ||
    !job.simulation ||
    signingPackage.jobId !== job.id ||
    !job.plan.actions.some((action) => action.id === signingPackage.actionId) ||
    !job.simulation.executableActionIds.includes(signingPackage.actionId) ||
    signingPackage.chainId !== job.incident.chainId ||
    !sameAddress(signingPackage.sourceAddress, job.incident.sourceAddress) ||
    !sameAddress(signingPackage.destinationAddress, job.incident.destinationAddress) ||
    !isRequestedAsset
  ) {
    throw new OkxProviderBridgeError(
      "HANDOFF_SCOPE_MISMATCH",
      "Refreshed SAFEEXIT signing package does not match the paid incident scope",
    );
  }
}

export class OkxA2AProviderBridge {
  private readonly supportedChainIds: ReadonlySet<number>;

  constructor(
    private readonly providerAgentId: string,
    private readonly clock: () => Date = () => new Date(),
    private readonly incidentIdFactory: () => string = () => `incident_${randomUUID()}`,
    supportedChainIds: readonly number[] = RESCUE_MAINNET_CHAIN_IDS,
  ) {
    if (!/^\d{1,32}$/.test(providerAgentId)) {
      throw new Error("SAFEEXIT OKX provider agent ID is invalid");
    }
    if (supportedChainIds.length === 0) {
      throw new Error("SAFEEXIT OKX provider bridge requires at least one supported chain");
    }
    this.supportedChainIds = new Set(supportedChainIds);
  }

  async prepareSigningDeliverable(
    lifecycle: SafeExitAgentLifecyclePort,
    value: OkxA2ATaskRequest,
  ): Promise<OkxA2ASigningDeliverable> {
    const request = okxA2ATaskRequestSchema.parse(value);
    assertProvider(this.providerAgentId, request.providerAgentId);
    if (!this.supportedChainIds.has(request.walletContext.chainId)) {
      throw new OkxProviderBridgeError(
        "HANDOFF_SCOPE_MISMATCH",
        "The normalized task chain is not enabled for this SAFEEXIT provider",
      );
    }
    const clock = this.clock();
    const confirmedAt = Date.parse(request.authorization.confirmedAt);
    if (
      confirmedAt > clock.getTime() + 5 * 60_000 ||
      confirmedAt < clock.getTime() - 24 * 60 * 60_000
    ) {
      throw new OkxProviderBridgeError(
        "HANDOFF_SCOPE_MISMATCH",
        "The wallet authorization confirmation is outside the accepted time window",
      );
    }
    const now = clock.toISOString();
    const incident = incidentSchema.parse({
      id: this.incidentIdFactory(),
      chainId: request.walletContext.chainId,
      sourceAddress: request.walletContext.sourceAddress,
      destinationAddress: request.walletContext.destinationAddress,
      assetManifest: request.assetManifest,
      status: "RECEIVED",
      ownershipAttestation: {
        accepted: true,
        statementVersion: statementVersionFor(request),
        attestedAt: request.authorization.confirmedAt,
      },
      createdAt: now,
      updatedAt: now,
    });

    let job = agentServiceJobSchema.parse(await lifecycle.createIncident({
      requestId: requestIdFor(request.providerAgentId, request.okxJobId),
      incident,
    }));
    if (job.status === "RECEIVED" || job.status === "WAITING_FOR_SOURCE") {
      job = agentServiceJobSchema.parse(await lifecycle.analyseIncident(job.id, incident));
    }
    if (job.status === "ANALYSING" && job.scan) {
      job = agentServiceJobSchema.parse(await lifecycle.generatePlan(job.id));
    }
    if (job.status === "PLAN_READY") {
      job = agentServiceJobSchema.parse(await lifecycle.simulatePlan(job.id));
    }
    if (job.status !== "WAITING_FOR_USER" || !job.simulation || job.simulation.status === "FAILED") {
      throw new OkxProviderBridgeError(
        "JOB_NOT_READY",
        `SAFEEXIT cannot prepare a signing package while the job is ${job.status}`,
      );
    }

    const signingPackages = signingPackageListSchema.parse(
      await lifecycle.getSigningPackages(job.id),
    );
    signingPackages.forEach((signingPackage) =>
      assertSigningScope(request, job, signingPackage));
    const issuedActionIds = signingPackages.map((signingPackage) => signingPackage.actionId);
    const issuedActionIdSet = new Set(issuedActionIds);
    const unavailableActionIds = job.plan?.actions
      .map((action) => action.id)
      .filter((actionId) => !issuedActionIdSet.has(actionId)) ?? [];
    return okxA2ASigningDeliverableSchema.parse({
      schemaVersion: "safeexit-okx-deliverable-v2",
      transportMode: "SAFEEXIT_NORMALIZED",
      okxJobId: request.okxJobId,
      providerAgentId: request.providerAgentId,
      safeExitJobId: job.id,
      status: "SIGNING_PACKAGES_READY",
      createdAt: this.clock().toISOString(),
      walletContext: request.walletContext,
      signingPackages: signingPackages.map((signingPackage) => ({
        ...signingPackageExecutionMetadata(signingPackage),
        signingPackage,
      })),
      coverage: {
        issuedActionIds,
        unavailableActionIds,
      },
      executionRequirements: {
        sourceSignerMustRemainLocal: true,
        destinationPaysSettlementGas: true,
        postSignatureSimulationRequired: true,
        sourceSignaturesMustNotBeReturned: true,
        receiptOnlyReportSchema: "safeexit-buyer-report-v1",
      },
    });
  }

  async preparePaidSigningDeliverable(
    lifecycle: SafeExitAgentLifecyclePort,
    value: OkxX402PrepareRequest,
  ): Promise<OkxX402SigningDeliverable> {
    const request = okxX402PrepareRequestSchema.parse(value);
    const deliverable = await this.prepareSigningDeliverable(lifecycle, {
      schemaVersion: "safeexit-okx-a2a-v1",
      transportMode: "SAFEEXIT_NORMALIZED",
      okxJobId: `x402:${request.requestId}`,
      providerAgentId: this.providerAgentId,
      ...(request.buyerAgentId ? { buyerAgentId: request.buyerAgentId } : {}),
      service: request.service,
      walletContext: request.walletContext,
      assetManifest: request.assetManifest,
      authorization: request.authorization,
    });
    return okxX402SigningDeliverableSchema.parse({
      schemaVersion: "safeexit-okx-x402-deliverable-v2",
      transportMode: "OKX_X402",
      requestId: request.requestId,
      providerAgentId: deliverable.providerAgentId,
      safeExitJobId: deliverable.safeExitJobId,
      status: deliverable.status,
      createdAt: deliverable.createdAt,
      walletContext: deliverable.walletContext,
      signingPackages: deliverable.signingPackages,
      coverage: deliverable.coverage,
      executionRequirements: deliverable.executionRequirements,
    });
  }

  async refreshPaidSigningDeliverable(
    lifecycle: SafeExitAgentLifecyclePort,
    value: OkxX402RefreshRequest,
  ): Promise<OkxX402SigningDeliverable> {
    const request = okxX402RefreshRequestSchema.parse(value);
    const job = agentServiceJobSchema.parse(await lifecycle.getJob(request.safeExitJobId));
    if (
      job.requestId !== requestIdFor(this.providerAgentId, `x402:${request.requestId}`) ||
      job.status !== "WAITING_FOR_USER" ||
      !job.incident ||
      !job.plan ||
      !job.simulation
    ) {
      throw new OkxProviderBridgeError(
        "HANDOFF_SCOPE_MISMATCH",
        "The continuation does not match a refreshable paid SAFEEXIT job",
      );
    }
    const signingPackages = signingPackageListSchema.parse(
      await lifecycle.getSigningPackages(job.id),
    );
    signingPackages.forEach((signingPackage) => {
      assertPersistedSigningScope(job, signingPackage);
      if (Date.parse(signingPackage.expiresAt) <= this.clock().getTime()) {
        throw new OkxProviderBridgeError(
          "JOB_NOT_READY",
          "SAFEEXIT did not issue a fresh signing package",
        );
      }
    });
    const issuedActionIds = signingPackages.map((signingPackage) => signingPackage.actionId);
    const issuedActionIdSet = new Set(issuedActionIds);
    return okxX402SigningDeliverableSchema.parse({
      schemaVersion: "safeexit-okx-x402-deliverable-v2",
      transportMode: "OKX_X402",
      requestId: request.requestId,
      providerAgentId: this.providerAgentId,
      safeExitJobId: job.id,
      status: "SIGNING_PACKAGES_READY",
      createdAt: this.clock().toISOString(),
      walletContext: {
        chainId: job.incident.chainId,
        sourceAddress: job.incident.sourceAddress,
        destinationAddress: job.incident.destinationAddress,
      },
      signingPackages: signingPackages.map((signingPackage) => ({
        ...signingPackageExecutionMetadata(signingPackage),
        signingPackage,
      })),
      coverage: {
        issuedActionIds,
        unavailableActionIds: job.plan.actions
          .map((action) => action.id)
          .filter((actionId) => !issuedActionIdSet.has(actionId)),
      },
      executionRequirements: {
        sourceSignerMustRemainLocal: true,
        destinationPaysSettlementGas: true,
        postSignatureSimulationRequired: true,
        sourceSignaturesMustNotBeReturned: true,
        receiptOnlyReportSchema: "safeexit-buyer-report-v1",
      },
    });
  }

  async recordBuyerReport(
    lifecycle: SafeExitAgentLifecyclePort,
    value: OkxA2ABuyerReportRequest,
  ): Promise<OkxA2ACompletionDeliverable> {
    const request = okxA2ABuyerReportRequestSchema.parse(value);
    assertProvider(this.providerAgentId, request.providerAgentId);
    if (request.safeExitJobId !== request.report.jobId) {
      throw new OkxProviderBridgeError(
        "HANDOFF_SCOPE_MISMATCH",
        "Buyer report job ID does not match the normalized OKX handoff",
      );
    }
    const existing = agentServiceJobSchema.parse(
      await lifecycle.getJob(request.safeExitJobId),
    );
    if (
      existing.requestId !== requestIdFor(request.providerAgentId, request.okxJobId)
    ) {
      throw new OkxProviderBridgeError(
        "HANDOFF_SCOPE_MISMATCH",
        "Buyer report does not match the OKX task bound to this SAFEEXIT job",
      );
    }
    const completed = agentServiceJobSchema.parse(
      await lifecycle.recordBuyerExecutionReport(request.safeExitJobId, request.report),
    );
    if (
      !["EXECUTING", "COMPLETED", "PARTIAL"].includes(completed.status) ||
      !completed.monitor
    ) {
      throw new OkxProviderBridgeError(
        "VERIFICATION_FAILED",
        "Buyer report did not produce a verified SAFEEXIT execution state",
      );
    }
    const issuedPackages = completed.signingPackages ??
      (completed.signingPackage ? [completed.signingPackage] : []);
    const completedActionIds = new Set(completed.monitor.completedActionIds);
    return okxA2ACompletionDeliverableSchema.parse({
      schemaVersion: "safeexit-okx-deliverable-v2",
      transportMode: "SAFEEXIT_NORMALIZED",
      okxJobId: request.okxJobId,
      providerAgentId: request.providerAgentId,
      safeExitJobId: completed.id,
      status: completed.status,
      observedAt: completed.monitor.observedAt,
      transactionHashes: completed.monitor.transactionHashes,
      completedActionIds: completed.monitor.completedActionIds,
      remainingPackageIds: issuedPackages
        .filter((signingPackage) => !completedActionIds.has(signingPackage.actionId))
        .map((signingPackage) => signingPackage.packageId),
      verification: {
        receiptStatusVerified: true,
        committedTransferVerified: true,
        sourceSignaturesReceivedBySafeExit: false,
      },
    });
  }
}
