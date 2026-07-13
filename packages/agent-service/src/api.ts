import { z } from "zod";

import { chainIdSchema, evmAddressSchema, incidentSchema } from "@safeexit/shared";

import { agentServiceJobSchema } from "./schemas";
import { signingPackageSchema } from "./signing-package";

const identifierSchema = z.string().min(1).max(256);

const walletContextSchema = z
  .strictObject({
    chainId: chainIdSchema,
    sourceAddress: evmAddressSchema,
    destinationAddress: evmAddressSchema,
    authorizationConfirmed: z.literal(true),
  })
  .superRefine(({ sourceAddress, destinationAddress }, context) => {
    if (sourceAddress.toLowerCase() === destinationAddress.toLowerCase()) {
      context.addIssue({
        code: "custom",
        message: "Source and destination addresses must be different",
        path: ["destinationAddress"],
      });
    }
  });

export const createAgentJobRequestSchema = z.strictObject({
  schemaVersion: z.literal("safeexit-agent-api-v1"),
  requestId: identifierSchema.optional(),
  walletContext: walletContextSchema.optional(),
});

export const analyseAgentJobRequestSchema = z.strictObject({
  schemaVersion: z.literal("safeexit-agent-api-v1"),
  incident: incidentSchema.optional(),
});

export const agentJobActionRequestSchema = z.strictObject({
  schemaVersion: z.literal("safeexit-agent-api-v1"),
});

export const agentJobResponseSchema = z.strictObject({
  schemaVersion: z.literal("safeexit-agent-api-v1"),
  job: agentServiceJobSchema,
});

export const signingPackageRequestSchema = z.strictObject({
  schemaVersion: z.literal("safeexit-agent-api-v1"),
});

export const signingPackageResponseSchema = z.strictObject({
  schemaVersion: z.literal("safeexit-agent-api-v1"),
  signingPackage: signingPackageSchema,
});

export type CreateAgentJobRequest = z.infer<typeof createAgentJobRequestSchema>;
export type AnalyseAgentJobRequest = z.infer<typeof analyseAgentJobRequestSchema>;
export type AgentJobActionRequest = z.infer<typeof agentJobActionRequestSchema>;
export type AgentJobResponse = z.infer<typeof agentJobResponseSchema>;
export type SigningPackageRequest = z.infer<typeof signingPackageRequestSchema>;
export type SigningPackageResponse = z.infer<typeof signingPackageResponseSchema>;
