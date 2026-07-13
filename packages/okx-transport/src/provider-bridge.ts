import { createHash, randomUUID } from "node:crypto";

import {
  agentServiceJobSchema,
  signingPackageSchema,
  type AgentServiceJob,
} from "@safeexit/agent-service";
import { incidentSchema } from "@safeexit/shared";

import {
  okxA2ABuyerReportRequestSchema,
  okxA2ACompletionDeliverableSchema,
  okxA2ASigningDeliverableSchema,
  okxA2ATaskRequestSchema,
  type OkxA2ABuyerReportRequest,
  type OkxA2ACompletionDeliverable,
  type OkxA2ASigningDeliverable,
  type OkxA2ATaskRequest,
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
  const canonicalAddresses = [...new Set(
    request.assetManifest.erc20TokenAddresses.map((address) => address.toLowerCase()),
  )].sort();
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
  signingPackage: ReturnType<typeof signingPackageSchema.parse>,
): void {
  if (
    signingPackage.jobId !== job.id ||
    signingPackage.chainId !== request.walletContext.chainId ||
    !sameAddress(signingPackage.sourceAddress, request.walletContext.sourceAddress) ||
    !sameAddress(signingPackage.destinationAddress, request.walletContext.destinationAddress)
  ) {
    throw new OkxProviderBridgeError(
      "HANDOFF_SCOPE_MISMATCH",
      "SAFEEXIT returned a signing package outside the normalized task scope",
    );
  }
}

export class OkxA2AProviderBridge {
  private readonly supportedChainIds: ReadonlySet<number>;

  constructor(
    private readonly providerAgentId: string,
    private readonly clock: () => Date = () => new Date(),
    private readonly incidentIdFactory: () => string = () => `incident_${randomUUID()}`,
    supportedChainIds: readonly number[] = [196],
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

    const signingPackage = signingPackageSchema.parse(
      await lifecycle.getSigningPackage(job.id),
    );
    assertSigningScope(request, job, signingPackage);
    return okxA2ASigningDeliverableSchema.parse({
      schemaVersion: "safeexit-okx-deliverable-v1",
      transportMode: "SAFEEXIT_NORMALIZED",
      okxJobId: request.okxJobId,
      providerAgentId: request.providerAgentId,
      safeExitJobId: job.id,
      status: "SIGNING_PACKAGE_READY",
      createdAt: this.clock().toISOString(),
      walletContext: request.walletContext,
      signingPackage,
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
    if (completed.status !== "COMPLETED" || !completed.monitor) {
      throw new OkxProviderBridgeError(
        "VERIFICATION_FAILED",
        "Buyer report did not produce a verified completed SAFEEXIT job",
      );
    }
    return okxA2ACompletionDeliverableSchema.parse({
      schemaVersion: "safeexit-okx-deliverable-v1",
      transportMode: "SAFEEXIT_NORMALIZED",
      okxJobId: request.okxJobId,
      providerAgentId: request.providerAgentId,
      safeExitJobId: completed.id,
      status: "COMPLETED",
      completedAt: completed.monitor.observedAt,
      transactionHashes: completed.monitor.transactionHashes,
      verification: {
        receiptStatusVerified: true,
        committedTransferVerified: true,
        sourceSignaturesReceivedBySafeExit: false,
      },
    });
  }
}
