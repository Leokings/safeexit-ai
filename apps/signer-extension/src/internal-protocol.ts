import { z } from "zod";

import {
  eip7702ExtensionReviewSchema,
  eip7702ExtensionSigningResultSchema,
  safeExitSignerRequestSchema,
  signedAuthorizationPairSchema,
} from "./protocol";

export const PENDING_SIGNER_SESSION_STORAGE_KEY =
  "safeexit.pendingSignerSession.v1" as const;

export const pendingSignerSessionSchema = z.strictObject({
  schemaVersion: z.literal("safeexit-pending-signer-session-v1"),
  sessionId: z.string().uuid(),
  requestId: z.string().min(8).max(128).regex(/^[a-zA-Z0-9:_-]+$/),
  origin: z.enum([
    "https://safeexit.xyz",
    "http://127.0.0.1:3000",
    "http://localhost:3000",
    "http://127.0.0.1:4179",
    "http://localhost:4179",
  ]),
  tabId: z.number().int().nonnegative().safe(),
  stagedAt: z.string().datetime({ offset: true }),
  review: eip7702ExtensionReviewSchema,
});

const statusRequestSchema = z.strictObject({
  method: z.literal("SAFEEXIT_INTERNAL_STATUS"),
});

const pageRequestSchema = z.strictObject({
  method: z.literal("SAFEEXIT_HANDLE_PAGE_REQUEST"),
  request: safeExitSignerRequestSchema,
});

const getPendingRequestSchema = z.strictObject({
  method: z.literal("SAFEEXIT_GET_PENDING_PACKAGE"),
});

const completeSigningRequestSchema = z.strictObject({
  method: z.literal("SAFEEXIT_COMPLETE_SIGNING"),
  sessionId: z.string().uuid(),
  authorizations: signedAuthorizationPairSchema,
});

const clearPendingRequestSchema = z.strictObject({
  method: z.literal("SAFEEXIT_CLEAR_PENDING_PACKAGE"),
  sessionId: z.string().uuid(),
});

export const safeExitInternalRequestSchema = z.discriminatedUnion("method", [
  statusRequestSchema,
  pageRequestSchema,
  getPendingRequestSchema,
  completeSigningRequestSchema,
  clearPendingRequestSchema,
]);

export const safeExitTabSigningResultMessageSchema = z.strictObject({
  method: z.literal("SAFEEXIT_SIGNING_RESULT"),
  origin: z.enum([
    "https://safeexit.xyz",
    "http://127.0.0.1:3000",
    "http://localhost:3000",
    "http://127.0.0.1:4179",
    "http://localhost:4179",
  ]),
  requestId: z.string().min(8).max(128).regex(/^[a-zA-Z0-9:_-]+$/),
  result: eip7702ExtensionSigningResultSchema,
});

export type PendingSignerSession = z.infer<
  typeof pendingSignerSessionSchema
>;
export type SafeExitInternalRequest = z.infer<
  typeof safeExitInternalRequestSchema
>;
