import { z } from "zod";

import {
  buyerExecutionReportSchema,
  signingPackageSchema,
} from "@safeexit/agent-service";
import { aiChatResponseSchema } from "@safeexit/ai";
import { isRescueMainnetChainId } from "@safeexit/chain";
import {
  chainIdSchema,
  evmAddressSchema,
  rescueAssetManifestSchema,
} from "@safeexit/shared";

export const SAFEEXIT_AUTHORIZATION_STATEMENT =
  "I confirm that I am authorised to control and sign for this wallet." as const;

const identifierSchema = z.string().min(1).max(180);
const agentIdSchema = z.string().regex(/^\d{1,32}$/);
const timestampSchema = z.string().datetime({ offset: true });
const transactionHashSchema = z.string().regex(/^0x[a-fA-F0-9]{64}$/);
const authorizationSchema = z.strictObject({
  statement: z.literal(SAFEEXIT_AUTHORIZATION_STATEMENT),
  confirmedAt: timestampSchema,
});

export const OKX_A2A_XLAYER_MAINNET_CHAIN_ID = 196;

export const okxA2AAssetManifestSchema = rescueAssetManifestSchema;

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

export const okxA2ATaskRequestSchema = z
  .strictObject({
    schemaVersion: z.literal("safeexit-okx-a2a-v1"),
    transportMode: z.literal("SAFEEXIT_NORMALIZED"),
    okxJobId: identifierSchema,
    providerAgentId: agentIdSchema,
    buyerAgentId: agentIdSchema.optional(),
    service: z.literal("compromised-wallet-rescue"),
    walletContext: walletContextSchema,
    assetManifest: okxA2AAssetManifestSchema,
    authorization: authorizationSchema,
  })
  .superRefine(({ walletContext }, context) => {
    if (!isRescueMainnetChainId(walletContext.chainId)) {
      context.addIssue({
        code: "custom",
        message: "SAFEEXIT does not have a verified adapter for this rescue chain",
        path: ["walletContext", "chainId"],
      });
    }
  });

export const okxX402PrepareRequestSchema = z
  .strictObject({
    schemaVersion: z.literal("safeexit-okx-x402-v1"),
    transportMode: z.literal("OKX_X402"),
    requestId: identifierSchema,
    buyerAgentId: agentIdSchema.optional(),
    service: z.literal("compromised-wallet-rescue"),
    walletContext: walletContextSchema,
    assetManifest: okxA2AAssetManifestSchema,
    authorization: authorizationSchema,
  })
  .superRefine(({ walletContext }, context) => {
    if (!isRescueMainnetChainId(walletContext.chainId)) {
      context.addIssue({
        code: "custom",
        message: "SAFEEXIT does not have a verified adapter for this rescue chain",
        path: ["walletContext", "chainId"],
      });
    }
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

export const okxX402SigningDeliverableSchema = z.strictObject({
  schemaVersion: z.literal("safeexit-okx-x402-deliverable-v1"),
  transportMode: z.literal("OKX_X402"),
  requestId: identifierSchema,
  providerAgentId: agentIdSchema,
  safeExitJobId: z.string().min(1).max(256),
  status: z.literal("SIGNING_PACKAGE_READY"),
  createdAt: timestampSchema,
  walletContext: walletContextSchema,
  signingPackage: signingPackageSchema,
  incidentAnalysis: z.strictObject({
    authority: z.literal("EXPLANATION_ONLY"),
    executablePlanSource: z.literal("DETERMINISTIC"),
    mode: z.enum(["DETERMINISTIC", "GATEWAY"]),
    fallbackUsed: z.boolean(),
    modelId: z.string().min(3).max(128).optional(),
    response: aiChatResponseSchema,
  }).optional(),
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
export type OkxA2AAssetManifest = z.infer<typeof okxA2AAssetManifestSchema>;
export type OkxA2ASigningDeliverable = z.infer<typeof okxA2ASigningDeliverableSchema>;
export type OkxX402PrepareRequest = z.infer<typeof okxX402PrepareRequestSchema>;
export type OkxX402SigningDeliverable = z.infer<typeof okxX402SigningDeliverableSchema>;
export type OkxA2ABuyerReportRequest = z.infer<typeof okxA2ABuyerReportRequestSchema>;
export type OkxA2ACompletionDeliverable = z.infer<typeof okxA2ACompletionDeliverableSchema>;
