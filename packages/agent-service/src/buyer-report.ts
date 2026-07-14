import { z } from "zod";

import { chainIdSchema, evmAddressSchema } from "@safeexit/shared";

const identifierSchema = z.string().min(1).max(256);
const timestampSchema = z.string().datetime({ offset: true });
const hashSchema = z.string().regex(/^0x[a-fA-F0-9]{64}$/);

export const buyerExecutionReportSchema = z
  .strictObject({
    schemaVersion: z.literal("safeexit-buyer-report-v1"),
    packageId: identifierSchema,
    jobId: identifierSchema,
    incidentId: identifierSchema,
    planId: identifierSchema,
    planHash: hashSchema,
    actionId: identifierSchema,
    route: z.enum([
      "ERC3009_RECEIVE_WITH_AUTHORIZATION",
      "ERC2612_PERMIT_SETTLEMENT",
      "DAI_PERMIT_SETTLEMENT",
      "ERC4494_PERMIT_SETTLEMENT",
    ]),
    chainId: chainIdSchema,
    sourceAddress: evmAddressSchema,
    destinationAddress: evmAddressSchema,
    status: z.literal("COMPLETED"),
    simulationProviderId: z.string().min(1).max(128),
    simulatedAt: timestampSchema,
    transactionHashes: z.array(hashSchema).min(1).max(8),
    completedAt: timestampSchema,
  })
  .superRefine((report, context) => {
    const uniqueHashes = new Set(report.transactionHashes.map((hash) => hash.toLowerCase()));
    if (uniqueHashes.size !== report.transactionHashes.length) {
      context.addIssue({
        code: "custom",
        message: "Buyer execution report transaction hashes must be unique",
        path: ["transactionHashes"],
      });
    }
  });

export type BuyerExecutionReport = z.infer<typeof buyerExecutionReportSchema>;
