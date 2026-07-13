import {
  agentServiceJobSchema,
  type AgentServiceJob,
} from "@safeexit/agent-service";
import {
  approvalSchema,
  assetSchema,
  incidentSchema,
  rescueActionSchema,
  rescuePlanSchema,
  simulationResultSchema,
  walletScanSchema,
} from "@safeexit/shared";

import { executionAttemptSchema } from "./schemas";

function date(value: string): Date {
  return new Date(value);
}

export function mapIncident(value: unknown) {
  const incident = incidentSchema.parse(value);
  return {
    id: incident.id,
    chainId: BigInt(incident.chainId),
    sourceAddress: incident.sourceAddress,
    destinationAddress: incident.destinationAddress,
    ...(incident.assetManifest ? { assetManifest: incident.assetManifest } : {}),
    status: incident.status,
    ownershipStatementVersion: incident.ownershipAttestation.statementVersion,
    ownershipAttestedAt: date(incident.ownershipAttestation.attestedAt),
    createdAt: date(incident.createdAt),
    updatedAt: date(incident.updatedAt),
  };
}

export function mapAsset(scanId: string, value: unknown) {
  const asset = assetSchema.parse(value);
  return {
    id: asset.id,
    scanId,
    chainId: BigInt(asset.chainId),
    ownerAddress: asset.ownerAddress,
    supportStatus: asset.supportStatus,
    observedAtBlock: asset.observedAtBlock,
    discoverySource: asset.discoverySource,
    confidence: asset.confidence,
    assetType: asset.assetType,
    contractAddress: "contractAddress" in asset ? asset.contractAddress : null,
    tokenId: "tokenId" in asset ? asset.tokenId : null,
    name: "name" in asset ? (asset.name ?? null) : null,
    symbol: "symbol" in asset ? asset.symbol : null,
    decimals: "decimals" in asset ? asset.decimals : null,
    balance: "balance" in asset ? asset.balance : null,
    estimatedValueUsd: asset.valuation?.estimatedValueUsd ?? null,
    valuationSource: asset.valuation?.source ?? null,
    valuationObservedAt: asset.valuation ? date(asset.valuation.observedAt) : null,
  };
}

export function mapApproval(scanId: string, value: unknown) {
  const approval = approvalSchema.parse(value);
  return {
    id: approval.id,
    scanId,
    chainId: BigInt(approval.chainId),
    ownerAddress: approval.ownerAddress,
    supportStatus: approval.supportStatus,
    observedAtBlock: approval.observedAtBlock,
    discoverySource: approval.discoverySource,
    approvalType: approval.approvalType,
    tokenAddress:
      approval.approvalType === "ERC20_ALLOWANCE" ? approval.tokenAddress : null,
    collectionAddress:
      approval.approvalType === "ERC20_ALLOWANCE"
        ? null
        : approval.collectionAddress,
    spenderAddress:
      approval.approvalType === "ERC20_ALLOWANCE"
        ? approval.spenderAddress
        : null,
    operatorAddress:
      approval.approvalType === "ERC20_ALLOWANCE"
        ? null
        : approval.operatorAddress,
    tokenId: approval.approvalType === "ERC721_TOKEN" ? approval.tokenId : null,
    amount: approval.approvalType === "ERC20_ALLOWANCE" ? approval.amount : null,
    standard: approval.approvalType === "NFT_OPERATOR" ? approval.standard : null,
    approved: approval.approvalType === "NFT_OPERATOR" ? approval.approved : null,
  };
}

export function mapWalletScan(value: unknown) {
  const scan = walletScanSchema.parse(value);
  return {
    scan: {
      id: scan.id,
      incidentId: scan.incidentId,
      chainId: BigInt(scan.chainId),
      address: scan.address,
      status: scan.status,
      providerId: scan.providerId,
      observedAtBlock: scan.observedAtBlock,
      observedAt: date(scan.observedAt),
      warnings: scan.warnings,
    },
    assets: scan.assets.map((asset) => mapAsset(scan.id, asset)),
    approvals: scan.approvals.map((approval) => mapApproval(scan.id, approval)),
    domain: scan,
  };
}

export function mapRescueAction(planId: string, position: number, value: unknown) {
  const action = rescueActionSchema.parse(value);
  return {
    id: action.id,
    planId,
    position,
    chainId: BigInt(action.chainId),
    sourceAddress: action.sourceAddress,
    actionType: action.actionType,
    dependencies: action.dependencies,
    evidenceIds: action.evidenceIds,
    expectedEffects: action.expectedEffects,
    riskLevel: action.riskLevel,
    estimatedValueUsd: action.estimatedValueUsd ?? null,
    supportStatus: action.supportStatus,
    simulationStatus: action.simulationStatus,
    parameters: action.parameters,
  };
}

export function mapRescuePlan(value: unknown) {
  const plan = rescuePlanSchema.parse(value);
  return {
    plan: {
      id: plan.id,
      incidentId: plan.incidentId,
      version: plan.version,
      policyVersion: plan.policyVersion,
      chainId: BigInt(plan.chainId),
      sourceAddress: plan.sourceAddress,
      destinationAddress: plan.destinationAddress,
      observedAtBlock: plan.observedAtBlock,
      status: plan.status,
      omissions: plan.omissions,
      integrityHash: plan.integrityHash,
      createdAt: date(plan.createdAt),
    },
    actions: plan.actions.map((action, position) =>
      mapRescueAction(plan.id, position, action),
    ),
    domain: plan,
  };
}

export function mapSimulation(value: unknown) {
  const simulation = simulationResultSchema.parse(value);
  return {
    id: simulation.id,
    planId: simulation.planId,
    actionId: simulation.actionId,
    providerId: simulation.providerId,
    status: simulation.status,
    planHash: simulation.planHash,
    observedAtBlock: simulation.observedAtBlock,
    gasEstimate: simulation.gasEstimate ?? null,
    expectedEffects: simulation.expectedEffects,
    assetChanges: simulation.assetChanges,
    warnings: simulation.warnings,
    failureReason: simulation.failureReason ?? null,
    simulatedAt: date(simulation.simulatedAt),
    expiresAt: date(simulation.expiresAt),
  };
}

export function mapExecutionAttempt(value: unknown) {
  const attempt = executionAttemptSchema.parse(value);
  return {
    id: attempt.id,
    incidentId: attempt.incidentId,
    planId: attempt.planId,
    attemptNumber: attempt.attemptNumber,
    status: attempt.status,
    transactionHash: attempt.transactionHash ?? null,
    submittedAt: attempt.submittedAt ? date(attempt.submittedAt) : null,
    confirmedAt: attempt.confirmedAt ? date(attempt.confirmedAt) : null,
    errorCode: attempt.errorCode ?? null,
    errorMessage: attempt.errorMessage ?? null,
    createdAt: date(attempt.createdAt),
    updatedAt: date(attempt.updatedAt),
  };
}

export function mapAgentJob(value: unknown): {
  job: ReturnType<typeof mapAgentJobRecord>;
  transitions: ReturnType<typeof mapAgentJobTransition>[];
  domain: AgentServiceJob;
} {
  const job = agentServiceJobSchema.parse(value);
  return {
    job: mapAgentJobRecord(job),
    transitions: job.history.map((transition) =>
      mapAgentJobTransition(job.id, transition),
    ),
    domain: job,
  };
}

function mapAgentJobRecord(job: AgentServiceJob) {
  return {
    id: job.id,
    requestId: job.requestId ?? null,
    incidentId: job.incident?.id ?? null,
    service: job.service,
    status: job.status,
    dashboardUrl: job.dashboardUrl ?? null,
    resultSummary: null,
    errorCode: job.error?.code ?? null,
    errorMessage: job.error?.message ?? null,
    revision: job.revision,
    state: job,
    createdAt: date(job.createdAt),
    updatedAt: date(job.updatedAt),
  };
}

function mapAgentJobTransition(
  jobId: string,
  transition: AgentServiceJob["history"][number],
) {
  return {
    jobId,
    sequence: transition.sequence,
    fromStatus: transition.from,
    toStatus: transition.to,
    reason: transition.reason,
    occurredAt: date(transition.at),
  };
}
