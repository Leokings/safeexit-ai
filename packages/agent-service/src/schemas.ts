import { z } from "zod";

import {
  incidentSchema,
  rescuePlanSchema,
  simulationResultSchema,
  walletScanSchema,
} from "@safeexit/shared";

import { signingPackageListSchema, signingPackageSchema } from "./signing-package";

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

export const buyerReceiptSubmissionStatusSchema = z.enum([
  "PENDING",
  "CONFIRMED",
  "REVERTED",
  "REJECTED",
]);

export const buyerReceiptSubmissionSchema = z.strictObject({
  packageId: identifierSchema,
  transactionHash: transactionHashSchema,
  status: buyerReceiptSubmissionStatusSchema,
  submittedAt: timestampSchema,
  updatedAt: timestampSchema,
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
    signingPackage: signingPackageSchema.optional(),
    signingPackages: signingPackageListSchema.optional(),
    receiptSubmissions: z.array(buyerReceiptSubmissionSchema).max(64).optional(),
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
    if (job.signingPackage && !job.simulation) {
      context.addIssue({
        code: "custom",
        message: "A signing package requires a simulation report",
        path: ["signingPackage"],
      });
    }
    if (job.signingPackages && !job.simulation) {
      context.addIssue({
        code: "custom",
        message: "Signing packages require a simulation report",
        path: ["signingPackages"],
      });
    }
    if (job.receiptSubmissions && !job.signingPackage && !job.signingPackages) {
      context.addIssue({
        code: "custom",
        message: "Receipt submissions require an issued signing package",
        path: ["receiptSubmissions"],
      });
    }
    if (job.receiptSubmissions) {
      const packageIds = new Set(
        (job.signingPackages ?? (job.signingPackage ? [job.signingPackage] : []))
          .map((signingPackage) => signingPackage.packageId),
      );
      const transactionHashes = new Set<string>();
      job.receiptSubmissions.forEach((submission, index) => {
        if (!packageIds.has(submission.packageId)) {
          context.addIssue({
            code: "custom",
            message: "Receipt submission must reference an issued signing package",
            path: ["receiptSubmissions", index, "packageId"],
          });
        }
        const normalizedHash = submission.transactionHash.toLowerCase();
        if (transactionHashes.has(normalizedHash)) {
          context.addIssue({
            code: "custom",
            message: "Receipt submission transaction hashes must be unique",
            path: ["receiptSubmissions", index, "transactionHash"],
          });
        }
        transactionHashes.add(normalizedHash);
      });
    }
    if (
      job.signingPackage &&
      job.signingPackages &&
      job.signingPackage.packageId !== job.signingPackages[0]?.packageId
    ) {
      context.addIssue({
        code: "custom",
        message: "The compatibility signing package must be the first issued package",
        path: ["signingPackage"],
      });
    }
    if (job.signingPackage && job.incident && job.plan) {
      const signingPackage = job.signingPackage;
      const scopeMatches =
        signingPackage.jobId === job.id &&
        signingPackage.incidentId === job.incident.id &&
        signingPackage.planId === job.plan.id &&
        signingPackage.planHash === job.plan.integrityHash &&
        signingPackage.chainId === job.plan.chainId &&
        signingPackage.sourceAddress.toLowerCase() === job.plan.sourceAddress.toLowerCase() &&
        signingPackage.destinationAddress.toLowerCase() ===
          job.plan.destinationAddress.toLowerCase() &&
        signingPackage.observedAtBlock === job.plan.observedAtBlock;
      if (!scopeMatches) {
        context.addIssue({
          code: "custom",
          message: "The signing package must exactly match the persisted job and plan scope",
          path: ["signingPackage"],
        });
      }
    }
    if (job.signingPackages && job.incident && job.plan) {
      job.signingPackages.forEach((signingPackage, index) => {
        const scopeMatches =
          signingPackage.jobId === job.id &&
          signingPackage.incidentId === job.incident?.id &&
          signingPackage.planId === job.plan?.id &&
          signingPackage.planHash.toLowerCase() === job.plan?.integrityHash.toLowerCase() &&
          signingPackage.chainId === job.plan?.chainId &&
          signingPackage.sourceAddress.toLowerCase() === job.plan?.sourceAddress.toLowerCase() &&
          signingPackage.destinationAddress.toLowerCase() ===
            job.plan?.destinationAddress.toLowerCase() &&
          signingPackage.observedAtBlock === job.plan?.observedAtBlock;
        if (!scopeMatches) {
          context.addIssue({
            code: "custom",
            message: "Every signing package must exactly match the persisted job and plan scope",
            path: ["signingPackages", index],
          });
        }
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
export type BuyerReceiptSubmissionStatus = z.infer<typeof buyerReceiptSubmissionStatusSchema>;
export type BuyerReceiptSubmission = z.infer<typeof buyerReceiptSubmissionSchema>;
export type AgentServiceError = z.infer<typeof agentServiceErrorSchema>;
export type AgentServiceJob = z.infer<typeof agentServiceJobSchema>;
export type CreateIncidentInput = z.infer<typeof createIncidentInputSchema>;
