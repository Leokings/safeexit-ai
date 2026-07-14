import { z } from "zod";

import {
  chainIdSchema,
  evmAddressSchema,
  rescueAssetManifestSchema,
} from "@safeexit/shared";

import {
  OKX_AI_INTEGRATION_BOUNDARIES,
  okxIntegrationBoundarySchema,
} from "./official-boundaries";
import { agentServiceJobSchema, agentServiceStatusSchema } from "./schemas";
import type { AgentServiceJob } from "./schemas";

const identifierSchema = z.string().min(1).max(256);

export const conceptualA2ARequestSchema = z
  .strictObject({
    schemaVersion: z.literal("safeexit-a2a-concept-v1"),
    requestId: identifierSchema,
    requesterReference: z.string().min(1).max(256).optional(),
    service: z.literal("safeexit-incident-response"),
    task: z.strictObject({
      kind: z.literal("ANALYSE_AND_PREPARE_RESCUE"),
      walletContext: z
        .strictObject({
          chainId: chainIdSchema,
          sourceAddress: evmAddressSchema,
          destinationAddress: evmAddressSchema,
          assetManifest: rescueAssetManifestSchema.optional(),
          authorizationConfirmed: z.literal(true),
        })
        .optional(),
      userNotes: z.string().max(2_000).optional(),
    }),
  })
  .superRefine(({ task }, context) => {
    if (
      task.walletContext &&
      task.walletContext.sourceAddress.toLowerCase() ===
        task.walletContext.destinationAddress.toLowerCase()
    ) {
      context.addIssue({
        code: "custom",
        message: "Conceptual A2A source and destination must be different",
        path: ["task", "walletContext", "destinationAddress"],
      });
    }
  });

export const conceptualA2AResponseSchema = z.strictObject({
  schemaVersion: z.literal("safeexit-a2a-concept-v1"),
  integrationMode: z.literal("CONCEPTUAL_ONLY"),
  requestId: identifierSchema,
  jobId: identifierSchema,
  responseStatus: z.enum(["ACCEPTED", "NEEDS_INPUT", "IN_PROGRESS", "DELIVERED", "FAILED"]),
  lifecycleStatus: agentServiceStatusSchema,
  dashboardUrl: z.string().url().optional(),
  deliverable: z.strictObject({
    scanId: identifierSchema.optional(),
    planId: identifierSchema.optional(),
    simulationStatus: z.enum(["SUCCEEDED", "PARTIAL", "FAILED"]).optional(),
    signingPackageId: identifierSchema.optional(),
    signingRoute: z.enum([
      "ERC3009_RECEIVE_WITH_AUTHORIZATION",
      "ERC2612_PERMIT_SETTLEMENT",
      "DAI_PERMIT_SETTLEMENT",
      "ERC4494_PERMIT_SETTLEMENT",
    ]).optional(),
    completedActionCount: z.number().int().nonnegative(),
    failedActionCount: z.number().int().nonnegative(),
    transactionHashes: z.array(z.string().regex(/^0x[a-fA-F0-9]{64}$/)),
    errorSummary: z.string().min(1).max(1_000).optional(),
  }),
  okxIntegrationBoundaries: z.array(okxIntegrationBoundarySchema).length(5),
});

function responseStatusFor(
  status: AgentServiceJob["status"],
): z.infer<typeof conceptualA2AResponseSchema>["responseStatus"] {
  switch (status) {
    case "RECEIVED":
      return "ACCEPTED";
    case "WAITING_FOR_SOURCE":
    case "WAITING_FOR_USER":
      return "NEEDS_INPUT";
    case "ANALYSING":
    case "PLAN_READY":
    case "SIGNING":
    case "EXECUTING":
      return "IN_PROGRESS";
    case "COMPLETED":
    case "PARTIAL":
      return "DELIVERED";
    case "FAILED":
      return "FAILED";
  }
}

export function toConceptualA2AResponse(
  requestId: string,
  value: AgentServiceJob,
): ConceptualA2AResponse {
  const job = agentServiceJobSchema.parse(value);
  if (job.requestId && job.requestId !== requestId) {
    throw new Error("Conceptual A2A request ID does not match the agent-service job");
  }
  return conceptualA2AResponseSchema.parse({
    schemaVersion: "safeexit-a2a-concept-v1",
    integrationMode: "CONCEPTUAL_ONLY",
    requestId,
    jobId: job.id,
    responseStatus: responseStatusFor(job.status),
    lifecycleStatus: job.status,
    ...(job.dashboardUrl ? { dashboardUrl: job.dashboardUrl } : {}),
    deliverable: {
      ...(job.scan ? { scanId: job.scan.id } : {}),
      ...(job.plan ? { planId: job.plan.id } : {}),
      ...(job.simulation ? { simulationStatus: job.simulation.status } : {}),
      ...(job.signingPackage
        ? {
            signingPackageId: job.signingPackage.packageId,
            signingRoute: job.signingPackage.route,
          }
        : {}),
      completedActionCount: job.monitor?.completedActionIds.length ?? 0,
      failedActionCount: job.monitor?.failedActionIds.length ?? 0,
      transactionHashes: job.monitor?.transactionHashes ?? [],
      ...(job.error ? { errorSummary: job.error.message } : {}),
    },
    okxIntegrationBoundaries: OKX_AI_INTEGRATION_BOUNDARIES,
  });
}

export type ConceptualA2ARequest = z.infer<typeof conceptualA2ARequestSchema>;
export type ConceptualA2AResponse = z.infer<typeof conceptualA2AResponseSchema>;
