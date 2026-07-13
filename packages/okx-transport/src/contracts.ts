import { z } from "zod";

import {
  buyerExecutionReportSchema,
  signingPackageSchema,
} from "@safeexit/agent-service";
import { chainIdSchema, evmAddressSchema } from "@safeexit/shared";

export const SAFEEXIT_AUTHORIZATION_STATEMENT =
  "I confirm that I am authorised to control and sign for this wallet." as const;

const identifierSchema = z.string().min(1).max(180);
const agentIdSchema = z.string().regex(/^\d{1,32}$/);
const timestampSchema = z.string().datetime({ offset: true });
const transactionHashSchema = z.string().regex(/^0x[a-fA-F0-9]{64}$/);

const walletContextSchema = z
  .strictObject({
    chainId: chainIdSchema,
    sourceAddress: evmAddressSchema,
    destinationAddress: evmAddressSchema,
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

export const okxA2ATaskRequestSchema = z.strictObject({
  schemaVersion: z.literal("safeexit-okx-a2a-v1"),
  transportMode: z.literal("SAFEEXIT_NORMALIZED"),
  okxJobId: identifierSchema,
  providerAgentId: agentIdSchema,
  buyerAgentId: agentIdSchema.optional(),
  service: z.literal("compromised-wallet-rescue"),
  walletContext: walletContextSchema,
  authorization: z.strictObject({
    statement: z.literal(SAFEEXIT_AUTHORIZATION_STATEMENT),
    confirmedAt: timestampSchema,
  }),
});

export const okxA2ASigningDeliverableSchema = z.strictObject({
  schemaVersion: z.literal("safeexit-okx-deliverable-v1"),
  transportMode: z.literal("SAFEEXIT_NORMALIZED"),
  okxJobId: identifierSchema,
  providerAgentId: agentIdSchema,
  safeExitJobId: z.string().min(1).max(256),
  status: z.literal("SIGNING_PACKAGE_READY"),
  createdAt: timestampSchema,
  walletContext: walletContextSchema,
  signingPackage: signingPackageSchema,
  executionRequirements: z.strictObject({
    sourceSignerMustRemainLocal: z.literal(true),
    destinationPaysSettlementGas: z.literal(true),
    postSignatureSimulationRequired: z.literal(true),
    sourceSignaturesMustNotBeReturned: z.literal(true),
    receiptOnlyReportSchema: z.literal("safeexit-buyer-report-v1"),
  }),
});

export const okxA2ABuyerReportRequestSchema = z.strictObject({
  schemaVersion: z.literal("safeexit-okx-a2a-v1"),
  transportMode: z.literal("SAFEEXIT_NORMALIZED"),
  okxJobId: identifierSchema,
  providerAgentId: agentIdSchema,
  safeExitJobId: z.string().min(1).max(256),
  report: buyerExecutionReportSchema,
});

export const okxA2ACompletionDeliverableSchema = z.strictObject({
  schemaVersion: z.literal("safeexit-okx-deliverable-v1"),
  transportMode: z.literal("SAFEEXIT_NORMALIZED"),
  okxJobId: identifierSchema,
  providerAgentId: agentIdSchema,
  safeExitJobId: z.string().min(1).max(256),
  status: z.literal("COMPLETED"),
  completedAt: timestampSchema,
  transactionHashes: z.array(transactionHashSchema).min(1).max(8),
  verification: z.strictObject({
    receiptStatusVerified: z.literal(true),
    committedTransferVerified: z.literal(true),
    sourceSignaturesReceivedBySafeExit: z.literal(false),
  }),
});

export type OkxA2ATaskRequest = z.infer<typeof okxA2ATaskRequestSchema>;
export type OkxA2ASigningDeliverable = z.infer<typeof okxA2ASigningDeliverableSchema>;
export type OkxA2ABuyerReportRequest = z.infer<typeof okxA2ABuyerReportRequestSchema>;
export type OkxA2ACompletionDeliverable = z.infer<typeof okxA2ACompletionDeliverableSchema>;
