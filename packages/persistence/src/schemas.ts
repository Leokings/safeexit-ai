import { z } from "zod";

const identifierSchema = z.string().min(1).max(256);
const timestampSchema = z.string().datetime({ offset: true });
const transactionHashSchema = z.string().regex(/^0x[a-fA-F0-9]{64}$/);

export const executionAttemptStatusSchema = z.enum([
  "CREATED",
  "WAITING_FOR_SIGNATURE",
  "SUBMITTED",
  "CONFIRMED",
  "PARTIAL",
  "FAILED",
]);

export const executionAttemptSchema = z
  .strictObject({
    id: identifierSchema,
    incidentId: identifierSchema,
    planId: identifierSchema,
    attemptNumber: z.number().int().positive(),
    status: executionAttemptStatusSchema,
    transactionHash: transactionHashSchema.optional(),
    submittedAt: timestampSchema.optional(),
    confirmedAt: timestampSchema.optional(),
    errorCode: z.string().min(1).max(128).optional(),
    errorMessage: z.string().min(1).max(1_000).optional(),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
  })
  .superRefine((attempt, context) => {
    if (
      ["SUBMITTED", "CONFIRMED"].includes(attempt.status) &&
      (!attempt.transactionHash || !attempt.submittedAt)
    ) {
      context.addIssue({
        code: "custom",
        message: "Submitted execution attempts require a transaction hash and timestamp",
        path: ["transactionHash"],
      });
    }
    if (attempt.status === "CONFIRMED" && !attempt.confirmedAt) {
      context.addIssue({
        code: "custom",
        message: "Confirmed execution attempts require a confirmation timestamp",
        path: ["confirmedAt"],
      });
    }
    if (attempt.status === "FAILED" && !attempt.errorCode) {
      context.addIssue({
        code: "custom",
        message: "Failed execution attempts require a stable error code",
        path: ["errorCode"],
      });
    }
  });

export type ExecutionAttemptStatus = z.infer<
  typeof executionAttemptStatusSchema
>;
export type ExecutionAttempt = z.infer<typeof executionAttemptSchema>;
