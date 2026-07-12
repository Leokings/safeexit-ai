import { z } from "zod";

import {
  approvalSchema,
  incidentSchema,
  incidentStatusSchema,
  rescueActionSchema,
  rescuePlanSchema,
  simulationResultSchema,
  walletScanSchema,
} from "@safeexit/shared";

const identifierSchema = z.string().min(1).max(256);
const timestampSchema = z.string().datetime({ offset: true });
const transactionHashSchema = z.string().regex(/^0x[a-fA-F0-9]{64}$/);

export const aiToolNameSchema = z.enum([
  "scan_wallet",
  "scan_approvals",
  "get_rescue_plan",
  "simulate_plan",
  "explain_action",
  "get_rescue_status",
]);

export const rescueStatusSnapshotSchema = z.strictObject({
  incidentId: identifierSchema,
  status: incidentStatusSchema,
  completedActionIds: z.array(identifierSchema),
  failedActionIds: z.array(identifierSchema),
  transactionHashes: z.array(transactionHashSchema),
  observedAt: timestampSchema,
});

export const aiIncidentContextSchema = z
  .strictObject({
    incident: incidentSchema,
    scan: walletScanSchema,
    plan: rescuePlanSchema.optional(),
    simulations: z.array(simulationResultSchema),
    status: rescueStatusSnapshotSchema,
  })
  .superRefine(({ incident, scan, plan, simulations, status }, context) => {
    if (scan.incidentId !== incident.id) {
      context.addIssue({
        code: "custom",
        message: "Scanner incident does not match AI incident context",
        path: ["scan", "incidentId"],
      });
    }
    if (
      scan.chainId !== incident.chainId ||
      scan.address.toLowerCase() !== incident.sourceAddress.toLowerCase()
    ) {
      context.addIssue({
        code: "custom",
        message: "Scanner scope does not match the incident source",
        path: ["scan"],
      });
    }
    if (status.incidentId !== incident.id) {
      context.addIssue({
        code: "custom",
        message: "Status incident does not match AI incident context",
        path: ["status", "incidentId"],
      });
    }

    if (!plan) {
      if (simulations.length > 0) {
        context.addIssue({
          code: "custom",
          message: "Simulation results require a rescue plan",
          path: ["simulations"],
        });
      }
      if (status.completedActionIds.length > 0 || status.failedActionIds.length > 0) {
        context.addIssue({
          code: "custom",
          message: "Action status requires a rescue plan",
          path: ["status"],
        });
      }
      return;
    }

    if (
      plan.incidentId !== incident.id ||
      plan.chainId !== incident.chainId ||
      plan.sourceAddress.toLowerCase() !== incident.sourceAddress.toLowerCase() ||
      plan.destinationAddress.toLowerCase() !== incident.destinationAddress.toLowerCase()
    ) {
      context.addIssue({
        code: "custom",
        message: "Rescue plan scope does not match the incident",
        path: ["plan"],
      });
    }

    const actionIds = new Set(plan.actions.map((action) => action.id));
    const statusActionIds = [
      ...status.completedActionIds,
      ...status.failedActionIds,
    ];
    for (const actionId of statusActionIds) {
      if (!actionIds.has(actionId)) {
        context.addIssue({
          code: "custom",
          message: "Status references an action outside the rescue plan",
          path: ["status"],
        });
      }
    }

    simulations.forEach((simulation, index) => {
      if (
        simulation.planId !== plan.id ||
        simulation.planHash.toLowerCase() !== plan.integrityHash.toLowerCase() ||
        !actionIds.has(simulation.actionId)
      ) {
        context.addIssue({
          code: "custom",
          message: "Simulation result does not match the rescue plan",
          path: ["simulations", index],
        });
      }
    });
  });

const incidentToolInputSchema = z.strictObject({ incidentId: identifierSchema });

export const aiToolCallSchema = z.discriminatedUnion("name", [
  z.strictObject({ name: z.literal("scan_wallet"), input: incidentToolInputSchema }),
  z.strictObject({ name: z.literal("scan_approvals"), input: incidentToolInputSchema }),
  z.strictObject({ name: z.literal("get_rescue_plan"), input: incidentToolInputSchema }),
  z.strictObject({ name: z.literal("simulate_plan"), input: z.strictObject({ planId: identifierSchema }) }),
  z.strictObject({
    name: z.literal("explain_action"),
    input: z.strictObject({ planId: identifierSchema, actionId: identifierSchema }),
  }),
  z.strictObject({ name: z.literal("get_rescue_status"), input: incidentToolInputSchema }),
]);

export const aiToolResultSchema = z.discriminatedUnion("name", [
  z.strictObject({ name: z.literal("scan_wallet"), output: walletScanSchema }),
  z.strictObject({
    name: z.literal("scan_approvals"),
    output: z.strictObject({ scanId: identifierSchema, approvals: z.array(approvalSchema) }),
  }),
  z.strictObject({ name: z.literal("get_rescue_plan"), output: rescuePlanSchema }),
  z.strictObject({
    name: z.literal("simulate_plan"),
    output: z.strictObject({
      planId: identifierSchema,
      results: z.array(simulationResultSchema),
      excludedActionIds: z.array(identifierSchema),
    }),
  }),
  z.strictObject({ name: z.literal("explain_action"), output: rescueActionSchema }),
  z.strictObject({ name: z.literal("get_rescue_status"), output: rescueStatusSnapshotSchema }),
]);

export const evidenceReferenceSchema = z.strictObject({
  source: z.enum([
    "INCIDENT",
    "SCAN",
    "ASSET",
    "APPROVAL",
    "PLAN",
    "ACTION",
    "SIMULATION",
    "STATUS",
  ]),
  recordId: identifierSchema,
  field: z.string().min(1).max(128).optional(),
});

export const explanationKindSchema = z.enum([
  "INCIDENT_REPORT",
  "PLAN_EXPLANATION",
  "APPROVAL_RISK",
  "SIMULATION_FAILURE",
  "ACTION_EXPLANATION",
  "STATUS_EXPLANATION",
  "REFUSAL",
]);

export const groundedExplanationSchema = z.strictObject({
  kind: explanationKindSchema,
  mode: z.enum(["DETERMINISTIC_GROUNDED", "MODEL_GROUNDED"]),
  severity: z.enum(["INFO", "LOW", "MEDIUM", "HIGH", "CRITICAL", "UNKNOWN"]),
  headline: z.string().min(1).max(180),
  statements: z.array(
    z.strictObject({
      text: z.string().min(1).max(1_000),
      evidence: z.array(evidenceReferenceSchema),
    }),
  ),
  limitations: z.array(z.string().min(1).max(500)),
  toolsUsed: z.array(aiToolNameSchema),
});

export const aiIntentSchema = z.enum([
  "INCIDENT_REPORT",
  "ASSET_SUMMARY",
  "APPROVAL_RISK",
  "PLAN_EXPLANATION",
  "SIMULATION_EXPLANATION",
  "ACTION_EXPLANATION",
  "STATUS_EXPLANATION",
  "REFUSAL",
]);

// A future model may select only an intent and known record IDs. It cannot author facts or calls.
export const groundedSelectionSchema = z.strictObject({
  intent: aiIntentSchema,
  selectedRecordIds: z.array(identifierSchema).max(64),
  requestedTool: aiToolNameSchema.optional(),
});

export const groundedModelInputSchema = z.strictObject({
  instructionsVersion: z.literal("safeexit-grounding-v1"),
  question: z.string().trim().min(1).max(1_000),
  allowedTools: z.array(aiToolNameSchema).length(6),
  availableRecordIds: z.array(identifierSchema).max(512),
});

export const aiChatRequestSchema = z.strictObject({
  question: z.string().trim().min(1).max(1_000),
  context: aiIncidentContextSchema,
  selection: groundedSelectionSchema.optional(),
});

export const aiChatResponseSchema = z.strictObject({
  explanation: groundedExplanationSchema,
  suggestedQuestions: z.array(z.string().min(1).max(180)).max(6),
});

export type AiToolName = z.infer<typeof aiToolNameSchema>;
export type AiIncidentContext = z.infer<typeof aiIncidentContextSchema>;
export type RescueStatusSnapshot = z.infer<typeof rescueStatusSnapshotSchema>;
export type AiToolCall = z.infer<typeof aiToolCallSchema>;
export type AiToolResult = z.infer<typeof aiToolResultSchema>;
export type EvidenceReference = z.infer<typeof evidenceReferenceSchema>;
export type GroundedExplanation = z.infer<typeof groundedExplanationSchema>;
export type GroundedSelection = z.infer<typeof groundedSelectionSchema>;
export type GroundedModelInput = z.infer<typeof groundedModelInputSchema>;
export type AiChatRequest = z.infer<typeof aiChatRequestSchema>;
export type AiChatResponse = z.infer<typeof aiChatResponseSchema>;
