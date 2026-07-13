import { z } from "zod";

import { chainIdSchema, evmAddressSchema } from "@safeexit/shared";
export {
  buyerExecutionReportSchema,
  type BuyerExecutionReport,
} from "@safeexit/agent-service";

const identifierSchema = z.string().min(1).max(256);
const timestampSchema = z.string().datetime({ offset: true });
const hashSchema = z.string().regex(/^0x[a-fA-F0-9]{64}$/);
const hexDataSchema = z.string().regex(/^0x(?:[a-fA-F0-9]{2})*$/);
const hexQuantitySchema = z.string().regex(/^0x(?:0|[1-9a-fA-F][a-fA-F0-9]*)$/);

export const buyerConfirmationSchema = z.strictObject({
  schemaVersion: z.literal("safeexit-buyer-confirmation-v1"),
  packageId: identifierSchema,
  planHash: hashSchema,
  chainId: chainIdSchema,
  sourceAddress: evmAddressSchema,
  destinationAddress: evmAddressSchema,
  authorizationConfirmed: z.literal(true),
  confirmedAt: timestampSchema,
});

export const settlementCallSchema = z.strictObject({
  to: evmAddressSchema,
  value: hexQuantitySchema,
  data: hexDataSchema,
});

export const settlementSimulationSchema = z.strictObject({
  status: z.enum(["SUCCEEDED", "FAILED"]),
  providerId: z.string().min(1).max(128),
  simulatedAt: timestampSchema,
  callCount: z.number().int().positive(),
  failureReason: z.string().min(1).max(1_000).optional(),
});

export const destinationSubmissionSchema = z.strictObject({
  submissionId: z.string().min(1).max(8_194),
});

export const destinationReceiptSchema = z.strictObject({
  status: z.enum(["CONFIRMED", "FAILED"]),
  transactionHashes: z.array(hashSchema).min(1),
  observedAt: timestampSchema,
  failureReason: z.string().min(1).max(1_000).optional(),
});

export type BuyerConfirmation = z.infer<typeof buyerConfirmationSchema>;
export type SettlementCall = z.infer<typeof settlementCallSchema>;
export type SettlementSimulation = z.infer<typeof settlementSimulationSchema>;
export type DestinationSubmission = z.infer<typeof destinationSubmissionSchema>;
export type DestinationReceipt = z.infer<typeof destinationReceiptSchema>;
