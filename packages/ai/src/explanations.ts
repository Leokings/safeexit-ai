import type { Approval, RescueAction } from "@safeexit/shared";

import {
  aiChatRequestSchema,
  aiChatResponseSchema,
  aiIncidentContextSchema,
  groundedExplanationSchema,
  type AiChatRequest,
  type AiChatResponse,
  type AiIncidentContext,
  type EvidenceReference,
  type GroundedExplanation,
} from "./schemas";
import { StructuredIncidentToolGateway } from "./tools";

const commonLimitations = [
  "The source is user reported compromised; SAFEEXIT does not independently prove compromise or original ownership.",
  "Recovery is best effort and is never guaranteed.",
  "This explanation cannot modify or execute the deterministic rescue plan.",
];

function evidence(
  source: EvidenceReference["source"],
  recordId: string,
  field?: string,
): EvidenceReference {
  return { source, recordId, ...(field ? { field } : {}) };
}

function parseContext(value: AiIncidentContext): AiIncidentContext {
  return aiIncidentContextSchema.parse(value);
}

function activeApproval(approval: Approval): boolean {
  switch (approval.approvalType) {
    case "ERC20_ALLOWANCE":
      return BigInt(approval.amount) > 0n;
    case "ERC721_TOKEN":
      return true;
    case "NFT_OPERATOR":
      return approval.approved;
  }
}

function quotedUntrusted(value: string | undefined): string {
  const normalized = (value ?? "No provider reason was recorded")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);
  return `“${normalized}”`;
}

function actionDescription(action: RescueAction): string {
  switch (action.actionType) {
    case "TRANSFER_NATIVE":
      return `Transfer up to ${action.parameters.maximumAmount} native base units to ${action.parameters.recipient}, after reserving execution gas.`;
    case "TRANSFER_ERC20":
      return `Transfer ${action.parameters.amount} ERC-20 base units from ${action.parameters.tokenAddress} to ${action.parameters.recipient}.`;
    case "TRANSFER_ERC721":
      return `Transfer ERC-721 token ${action.parameters.tokenId} from ${action.parameters.collectionAddress} to ${action.parameters.recipient}.`;
    case "TRANSFER_ERC1155":
      return `Transfer ${action.parameters.amount} units of ERC-1155 token ${action.parameters.tokenId} from ${action.parameters.collectionAddress} to ${action.parameters.recipient}.`;
    case "REVOKE_ERC20_APPROVAL":
      return `Set the allowance for ${action.parameters.spenderAddress} on token ${action.parameters.tokenAddress} to zero.`;
    case "REVOKE_NFT_OPERATOR":
      return `Remove ${action.parameters.standard} operator ${action.parameters.operatorAddress} from collection ${action.parameters.collectionAddress}.`;
    case "CLAIM_SUPPORTED_AIRDROP":
      return `Claim the allowlisted adapter record ${action.parameters.claimReference} from ${action.parameters.contractAddress}.`;
    case "WITHDRAW_SUPPORTED_POSITION":
      return `Withdraw allowlisted position ${action.parameters.positionId} from ${action.parameters.contractAddress}.`;
    case "CUSTOM_SUPPORTED_ADAPTER":
      return `Run allowlisted adapter operation ${action.parameters.operationId} on ${action.parameters.contractAddress}.`;
  }
}

function approvalStatement(approval: Approval): string {
  switch (approval.approvalType) {
    case "ERC20_ALLOWANCE":
      return `The scanner recorded an ERC-20 allowance of ${approval.amount} base units for spender ${approval.spenderAddress} on token ${approval.tokenAddress}. An allowance permits that spender to request transfers within the recorded limit, subject to current token state; this does not by itself prove the spender is malicious.`;
    case "ERC721_TOKEN":
      return `The scanner recorded operator ${approval.operatorAddress} as approved for ERC-721 token ${approval.tokenId} in collection ${approval.collectionAddress}. The approval should be reviewed even though the scanner does not classify the operator as malicious.`;
    case "NFT_OPERATOR":
      return `The scanner recorded ${approval.operatorAddress} as an active ${approval.standard} operator for collection ${approval.collectionAddress}. Operator approval can cover collection assets; the scanner does not infer the operator's intent.`;
  }
}

export function generateIncidentReport(value: AiIncidentContext): GroundedExplanation {
  const context = parseContext(value);
  const gateway = new StructuredIncidentToolGateway(context);
  const scanResult = gateway.invoke({
    name: "scan_wallet",
    input: { incidentId: context.incident.id },
  });
  const statusResult = gateway.invoke({
    name: "get_rescue_status",
    input: { incidentId: context.incident.id },
  });
  if (scanResult.name !== "scan_wallet" || statusResult.name !== "get_rescue_status") {
    throw new Error("Grounded tool gateway returned an unexpected result");
  }

  const activeApprovals = scanResult.output.approvals.filter(activeApproval);
  const uncertainEvidence = [
    ...scanResult.output.assets,
    ...scanResult.output.approvals,
  ].filter((item) => item.supportStatus === "UNKNOWN" || item.supportStatus === "UNSUPPORTED");
  const failedSimulations = context.simulations.filter(
    (simulation) => simulation.status !== "SUCCEEDED",
  );
  const severity =
    failedSimulations.length > 0 || activeApprovals.length > 0
      ? "HIGH"
      : scanResult.output.status === "COMPLETE"
        ? "MEDIUM"
        : "UNKNOWN";

  return groundedExplanationSchema.parse({
    kind: "INCIDENT_REPORT",
    mode: "DETERMINISTIC_GROUNDED",
    severity,
    headline: "Grounded incident report",
    statements: [
      {
        text: "The source wallet is user reported compromised. SAFEEXIT records that report without claiming to independently verify compromise or ownership.",
        evidence: [evidence("INCIDENT", context.incident.id, "sourceAddress")],
      },
      {
        text: `The ${scanResult.output.status.toLowerCase()} scanner snapshot at block ${scanResult.output.observedAtBlock} contains ${scanResult.output.assets.length} asset record(s) and ${activeApprovals.length} active approval record(s).`,
        evidence: [
          evidence("SCAN", scanResult.output.id, "status"),
          evidence("SCAN", scanResult.output.id, "observedAtBlock"),
        ],
      },
      {
        text: `The recorded rescue status is ${statusResult.output.status}. ${statusResult.output.completedActionIds.length} action(s) are recorded complete and ${statusResult.output.failedActionIds.length} action(s) are recorded failed.`,
        evidence: [evidence("STATUS", context.status.incidentId, "status")],
      },
      ...(uncertainEvidence.length > 0
        ? [
            {
              text: `${uncertainEvidence.length} evidence record(s) are unsupported or unknown and must not be treated as empty or safe.`,
              evidence: uncertainEvidence.map((item) =>
                evidence(
                  "approvalType" in item ? "APPROVAL" : "ASSET",
                  item.id,
                  "supportStatus",
                ),
              ),
            },
          ]
        : []),
    ],
    limitations: commonLimitations,
    toolsUsed: ["scan_wallet", "get_rescue_status"],
  });
}

export function explainRescuePlan(value: AiIncidentContext): GroundedExplanation {
  const context = parseContext(value);
  const gateway = new StructuredIncidentToolGateway(context);
  const result = gateway.invoke({
    name: "get_rescue_plan",
    input: { incidentId: context.incident.id },
  });
  if (result.name !== "get_rescue_plan") {
    throw new Error("Grounded tool gateway returned an unexpected result");
  }

  return groundedExplanationSchema.parse({
    kind: "PLAN_EXPLANATION",
    mode: "DETERMINISTIC_GROUNDED",
    severity: result.output.status === "PARTIAL" ? "HIGH" : "MEDIUM",
    headline: "Deterministic rescue-plan explanation",
    statements: result.output.actions.map((action, index) => ({
      text: `Step ${index + 1}: ${actionDescription(action)} ${
        action.dependencies.length > 0
          ? `It depends on ${action.dependencies.join(", ")}.`
          : "It has no action dependency."
      }`,
      evidence: [evidence("ACTION", action.id)],
    })),
    limitations: [
      ...commonLimitations,
      `${result.output.omissions.length} plan omission(s) are recorded and remain outside executable actions.`,
    ],
    toolsUsed: ["get_rescue_plan"],
  });
}

export function explainApprovalRisk(
  value: AiIncidentContext,
  approvalId?: string,
): GroundedExplanation {
  const context = parseContext(value);
  const gateway = new StructuredIncidentToolGateway(context);
  const result = gateway.invoke({
    name: "scan_approvals",
    input: { incidentId: context.incident.id },
  });
  if (result.name !== "scan_approvals") {
    throw new Error("Grounded tool gateway returned an unexpected result");
  }

  const approvals = approvalId
    ? result.output.approvals.filter((approval) => approval.id === approvalId)
    : result.output.approvals.filter(activeApproval);
  if (approvalId && approvals.length === 0) {
    throw new Error("Requested approval is not available in the scanner snapshot");
  }

  return groundedExplanationSchema.parse({
    kind: "APPROVAL_RISK",
    mode: "DETERMINISTIC_GROUNDED",
    severity: approvals.length > 0 ? "HIGH" : "INFO",
    headline:
      approvals.length > 0 ? "Recorded approval exposure" : "No active approval in this snapshot",
    statements:
      approvals.length > 0
        ? approvals.map((approval) => ({
            text: approvalStatement(approval),
            evidence: [evidence("APPROVAL", approval.id)],
          }))
        : [
            {
              text: "The current structured scanner snapshot contains no active approval record. This is not proof that no unscanned approval exists.",
              evidence: [evidence("SCAN", result.output.scanId, "approvals")],
            },
          ],
    limitations: [
      ...commonLimitations,
      "An approval record does not prove that a spender or operator is malicious.",
    ],
    toolsUsed: ["scan_approvals"],
  });
}

export function explainSimulationFailure(
  value: AiIncidentContext,
  actionId?: string,
): GroundedExplanation {
  const context = parseContext(value);
  if (!context.plan) {
    throw new Error("No rescue plan is available for simulation explanation");
  }
  const gateway = new StructuredIncidentToolGateway(context);
  const result = gateway.invoke({ name: "simulate_plan", input: { planId: context.plan.id } });
  if (result.name !== "simulate_plan") {
    throw new Error("Grounded tool gateway returned an unexpected result");
  }

  const failures = result.output.results.filter(
    (simulation) =>
      simulation.status !== "SUCCEEDED" && (!actionId || simulation.actionId === actionId),
  );

  return groundedExplanationSchema.parse({
    kind: "SIMULATION_FAILURE",
    mode: "DETERMINISTIC_GROUNDED",
    severity: failures.length > 0 ? "HIGH" : "INFO",
    headline: failures.length > 0 ? "Simulation failure explanation" : "No recorded simulation failure",
    statements:
      failures.length > 0
        ? failures.map((failure) => ({
            text: `Provider ${failure.providerId} recorded ${failure.status} for action ${failure.actionId}. Recorded reason: ${quotedUntrusted(failure.failureReason)}. The action remains excluded by default.`,
            evidence: [evidence("SIMULATION", failure.id)],
          }))
        : [
            {
              text: `The structured snapshot contains ${result.output.results.length} simulation result(s) and none are recorded as failed, reverted, unsupported, or errored.`,
              evidence: result.output.results.map((simulation) =>
                evidence("SIMULATION", simulation.id, "status"),
              ),
            },
          ],
    limitations: [
      ...commonLimitations,
      "A successful simulation is not a guarantee that a later transaction will execute successfully.",
    ],
    toolsUsed: ["simulate_plan"],
  });
}

export function explainAction(
  value: AiIncidentContext,
  actionId: string,
): GroundedExplanation {
  const context = parseContext(value);
  if (!context.plan) {
    throw new Error("No rescue plan is available for action explanation");
  }
  const gateway = new StructuredIncidentToolGateway(context);
  const result = gateway.invoke({
    name: "explain_action",
    input: { planId: context.plan.id, actionId },
  });
  if (result.name !== "explain_action") {
    throw new Error("Grounded tool gateway returned an unexpected result");
  }

  return groundedExplanationSchema.parse({
    kind: "ACTION_EXPLANATION",
    mode: "DETERMINISTIC_GROUNDED",
    severity: result.output.riskLevel,
    headline: `Action ${result.output.actionType}`,
    statements: [
      {
        text: `${actionDescription(result.output)} ${
          result.output.dependencies.length > 0
            ? `Recorded dependencies: ${result.output.dependencies.join(", ")}.`
            : "No action dependency is recorded."
        }`,
        evidence: [evidence("ACTION", result.output.id)],
      },
    ],
    limitations: commonLimitations,
    toolsUsed: ["explain_action"],
  });
}

function statusExplanation(context: AiIncidentContext): GroundedExplanation {
  const gateway = new StructuredIncidentToolGateway(context);
  const result = gateway.invoke({
    name: "get_rescue_status",
    input: { incidentId: context.incident.id },
  });
  if (result.name !== "get_rescue_status") {
    throw new Error("Grounded tool gateway returned an unexpected result");
  }
  return groundedExplanationSchema.parse({
    kind: "STATUS_EXPLANATION",
    mode: "DETERMINISTIC_GROUNDED",
    severity: result.output.status === "FAILED" ? "HIGH" : "INFO",
    headline: "Recorded rescue status",
    statements: [
      {
        text: `Status is ${result.output.status}. ${result.output.completedActionIds.length} action(s) are recorded complete, ${result.output.failedActionIds.length} action(s) are recorded failed, and ${result.output.transactionHashes.length} transaction hash(es) are recorded.`,
        evidence: [evidence("STATUS", result.output.incidentId)],
      },
    ],
    limitations: commonLimitations,
    toolsUsed: ["get_rescue_status"],
  });
}

function refusal(headline: string, text: string): GroundedExplanation {
  return groundedExplanationSchema.parse({
    kind: "REFUSAL",
    mode: "DETERMINISTIC_GROUNDED",
    severity: "INFO",
    headline,
    statements: [{ text, evidence: [] }],
    limitations: commonLimitations,
    toolsUsed: [],
  });
}

function knownRecordIds(context: AiIncidentContext): Set<string> {
  return new Set([
    context.incident.id,
    context.scan.id,
    ...context.scan.assets.map((asset) => asset.id),
    ...context.scan.approvals.map((approval) => approval.id),
    ...(context.plan ? [context.plan.id, ...context.plan.actions.map((action) => action.id)] : []),
    ...context.simulations.map((simulation) => simulation.id),
    context.status.incidentId,
  ]);
}

export function answerIncidentQuestion(value: AiChatRequest): AiChatResponse {
  const request = aiChatRequestSchema.parse(value);
  const context = request.context;
  const question = request.question.toLowerCase();

  if (request.selection) {
    const knownIds = knownRecordIds(context);
    const unknownId = request.selection.selectedRecordIds.find((id) => !knownIds.has(id));
    if (unknownId) {
      throw new Error("Grounded model selection references evidence outside the incident context");
    }
  }

  let explanation: GroundedExplanation;
  if (/seed phrase|private key|mnemonic|keystore|raw credential/.test(question)) {
    explanation = refusal(
      "Wallet secret request refused",
      "SAFEEXIT never requests, receives, stores, or explains how to transmit wallet secrets. Signing must remain in a user-controlled local wallet.",
    );
  } else if (
    /drain|steal|wallet i do not own|bypass signature|arbitrary call|arbitrary contract|calldata|change (the )?recipient|replace (the )?destination|sign for me|broadcast for me|execute for me/.test(
      question,
    )
  ) {
    explanation = refusal(
      "Execution request refused",
      "The explanation layer cannot create arbitrary calls, change recipients, bypass signatures, or execute transactions. It can only describe the validated incident snapshot and allowlisted plan actions.",
    );
  } else if (/guarantee|promise recovery|100% recover|certain recovery/.test(question)) {
    explanation = refusal(
      "Guarantee request refused",
      "SAFEEXIT cannot guarantee recovery. It can report current structured evidence, explain the deterministic plan, and describe recorded simulation results.",
    );
  } else {
    const selectedIntent = request.selection?.intent;
    if (selectedIntent === "APPROVAL_RISK" || /approval|allowance|operator|spender/.test(question)) {
      explanation = explainApprovalRisk(context);
    } else if (
      selectedIntent === "SIMULATION_EXPLANATION" ||
      /simulation|simulate|revert|failure|failed|gas/.test(question)
    ) {
      explanation = explainSimulationFailure(context);
    } else if (
      selectedIntent === "PLAN_EXPLANATION" ||
      /plan|order|sequence|why this action|rescue action/.test(question)
    ) {
      explanation = explainRescuePlan(context);
    } else if (selectedIntent === "ACTION_EXPLANATION") {
      const actionId = request.selection?.selectedRecordIds.find((id) =>
        context.plan?.actions.some((action) => action.id === id),
      );
      explanation = actionId ? explainAction(context, actionId) : explainRescuePlan(context);
    } else if (
      selectedIntent === "STATUS_EXPLANATION" ||
      /status|executed|complete|completed|transaction hash/.test(question)
    ) {
      explanation = statusExplanation(context);
    } else {
      explanation = generateIncidentReport(context);
    }
  }

  return aiChatResponseSchema.parse({
    explanation,
    suggestedQuestions: [
      "Why is the allowance risky?",
      "Explain the rescue-plan order.",
      "Did any simulation fail?",
      "What is the recorded rescue status?",
    ],
  });
}
