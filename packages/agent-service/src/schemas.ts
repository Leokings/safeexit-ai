import { z } from "zod";

import {
  incidentSchema,
  rescuePlanSchema,
  simulationResultSchema,
  walletScanSchema,
} from "@safeexit/shared";

const identifierSchema = z.string().min(1).max(256);
const timestampSchema = z.string().datetime({ offset: true });
const transactionHashSchema = z.string().regex(/^0x[a-fA-F0-9]{64}$/);

export const agentServiceStatusSchema = z.enum([
  "RECEIVED",
  "WAITING_FOR_SOURCE",
  "ANALYSING",
  "PLAN_READY",
  "WAITING_FOR_USER",
  "SIGNING",
  "EXECUTING",
  "COMPLETED",
  "PARTIAL",
  "FAILED",
]);

export const transitionReasonSchema = z.enum([
  "JOB_CREATED",
  "SOURCE_REQUIRED",
  "ANALYSIS_STARTED",
  "ANALYSIS_FAILED",
  "PLAN_GENERATED",
  "PLAN_FAILED",
  "SIMULATION_READY",
  "SIMULATION_FAILED",
  "SIGNING_OBSERVED",
  "EXECUTION_OBSERVED",
  "RESCUE_COMPLETED",
  "RESCUE_PARTIAL",
  "RESCUE_FAILED",
]);

export const lifecycleTransitionSchema = z.strictObject({
  sequence: z.number().int().nonnegative(),
  from: agentServiceStatusSchema.nullable(),
  to: agentServiceStatusSchema,
  reason: transitionReasonSchema,
  at: timestampSchema,
});

export const agentSimulationReportSchema = z.strictObject({
  status: z.enum(["SUCCEEDED", "PARTIAL", "FAILED"]),
  providerId: z.string().min(1).max(128),
  results: z.array(simulationResultSchema),
  executableActionIds: z.array(identifierSchema),
  excludedActionIds: z.array(identifierSchema),
});

export const rescueMonitorObservationSchema = z.strictObject({
  phase: z.enum([
    "WAITING_FOR_USER",
    "SIGNING",
    "EXECUTING",
    "COMPLETED",
    "PARTIAL",
    "FAILED",
  ]),
  completedActionIds: z.array(identifierSchema),
  failedActionIds: z.array(identifierSchema),
  transactionHashes: z.array(transactionHashSchema),
  observedAt: timestampSchema,
  detail: z.string().min(1).max(500).optional(),
});

export const agentServiceErrorSchema = z.strictObject({
  code: z.enum([
    "ANALYSIS_FAILED",
    "PLAN_FAILED",
    "SIMULATION_FAILED",
    "MONITOR_FAILED",
  ]),
  message: z.string().min(1).max(1_000),
});

export const agentServiceJobSchema = z
  .strictObject({
    id: identifierSchema,
    requestId: identifierSchema.optional(),
    service: z.literal("safeexit-incident-response"),
    status: agentServiceStatusSchema,
    incident: incidentSchema.optional(),
    scan: walletScanSchema.optional(),
    plan: rescuePlanSchema.optional(),
    simulation: agentSimulationReportSchema.optional(),
    monitor: rescueMonitorObservationSchema.optional(),
    dashboardUrl: z.string().url().optional(),
    error: agentServiceErrorSchema.optional(),
    history: z.array(lifecycleTransitionSchema).min(1),
    revision: z.number().int().nonnegative(),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
  })
  .superRefine((job, context) => {
    const lastTransition = job.history.at(-1);
    if (!lastTransition || lastTransition.to !== job.status) {
      context.addIssue({
        code: "custom",
        message: "The latest lifecycle transition must match the job status",
        path: ["history"],
      });
    }
    job.history.forEach((transition, index) => {
      if (transition.sequence !== index) {
        context.addIssue({
          code: "custom",
          message: "Lifecycle transition sequence must be contiguous",
          path: ["history", index, "sequence"],
        });
      }
      if (index === 0 && transition.from !== null) {
        context.addIssue({
          code: "custom",
          message: "The initial lifecycle transition must start from null",
          path: ["history", index, "from"],
        });
      }
      if (index > 0 && transition.from !== job.history[index - 1]?.to) {
        context.addIssue({
          code: "custom",
          message: "Lifecycle transition history is discontinuous",
          path: ["history", index, "from"],
        });
      }
    });

    if (job.scan && !job.incident) {
      context.addIssue({ code: "custom", message: "A scan requires an incident", path: ["scan"] });
    }
    if (job.plan && !job.scan) {
      context.addIssue({ code: "custom", message: "A plan requires a scan", path: ["plan"] });
    }
    if (job.simulation && !job.plan) {
      context.addIssue({
        code: "custom",
        message: "A simulation report requires a plan",
        path: ["simulation"],
      });
    }
    if (job.status === "WAITING_FOR_SOURCE" && job.incident) {
      context.addIssue({
        code: "custom",
        message: "A source-waiting job must not claim a complete incident",
        path: ["incident"],
      });
    }
    if (
      !["RECEIVED", "WAITING_FOR_SOURCE", "FAILED"].includes(job.status) &&
      !job.incident
    ) {
      context.addIssue({
        code: "custom",
        message: "This lifecycle status requires an incident",
        path: ["incident"],
      });
    }
    if (job.error && job.status !== "FAILED") {
      context.addIssue({
        code: "custom",
        message: "A service error may only be attached to a failed job",
        path: ["error"],
      });
    }
  });

export const createIncidentInputSchema = z.strictObject({
  requestId: identifierSchema.optional(),
  incident: incidentSchema.optional(),
});

export type AgentServiceStatus = z.infer<typeof agentServiceStatusSchema>;
export type TransitionReason = z.infer<typeof transitionReasonSchema>;
export type LifecycleTransition = z.infer<typeof lifecycleTransitionSchema>;
export type AgentSimulationReport = z.infer<typeof agentSimulationReportSchema>;
export type RescueMonitorObservation = z.infer<typeof rescueMonitorObservationSchema>;
export type AgentServiceError = z.infer<typeof agentServiceErrorSchema>;
export type AgentServiceJob = z.infer<typeof agentServiceJobSchema>;
export type CreateIncidentInput = z.infer<typeof createIncidentInputSchema>;
