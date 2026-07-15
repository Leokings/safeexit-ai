import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import {
  okxX402ContinuationSchema,
  type OkxX402Continuation,
} from "@safeexit/okx-transport";
import { chainIdSchema } from "@safeexit/shared";
import { z } from "zod";

import type { DeploymentEnvironment } from "./deployment-env";

const CONTINUATION_TTL_MS = 24 * 60 * 60_000;
const continuationPayloadSchema = z.strictObject({
  version: z.literal("safeexit-paid-continuation-v1"),
  requestId: z.string().min(1).max(180),
  safeExitJobId: z.string().min(1).max(256),
  providerAgentId: z.string().regex(/^\d{1,32}$/),
  chainId: chainIdSchema,
  issuedAt: z.number().int().nonnegative(),
  expiresAt: z.number().int().positive(),
});

export type PaidContinuationScope = Readonly<{
  requestId: string;
  safeExitJobId: string;
  providerAgentId: string;
  chainId: number;
}>;

export class PaidContinuationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PaidContinuationError";
  }
}

function continuationKey(agentApiKey: string): Buffer {
  return createHash("sha256")
    .update("safeexit-paid-continuation-key-v1\0")
    .update(agentApiKey)
    .digest();
}

function requiredConfiguration(
  config: DeploymentEnvironment,
): { agentApiKey: string; providerAgentId: string } {
  if (!config.agentApiKey || !config.okxProviderAgentId) {
    throw new PaidContinuationError("Paid continuation is not configured");
  }
  return {
    agentApiKey: config.agentApiKey,
    providerAgentId: config.okxProviderAgentId,
  };
}

function signatureFor(agentApiKey: string, payload: string): Buffer {
  return createHmac("sha256", continuationKey(agentApiKey)).update(payload).digest();
}

export function issuePaidContinuation(
  config: DeploymentEnvironment,
  scope: PaidContinuationScope,
  now: Date = new Date(),
): OkxX402Continuation {
  const required = requiredConfiguration(config);
  if (scope.providerAgentId !== required.providerAgentId) {
    throw new PaidContinuationError("Paid continuation provider scope is invalid");
  }
  const payload = continuationPayloadSchema.parse({
    version: "safeexit-paid-continuation-v1",
    ...scope,
    issuedAt: now.getTime(),
    expiresAt: now.getTime() + CONTINUATION_TTL_MS,
  });
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = signatureFor(required.agentApiKey, encodedPayload).toString("base64url");
  return okxX402ContinuationSchema.parse({
    schemaVersion: "safeexit-paid-continuation-v1",
    refreshUrl: new URL("/api/agent/okx/refresh-paid", config.publicBaseUrl).toString(),
    token: `${encodedPayload}.${signature}`,
    expiresAt: new Date(payload.expiresAt).toISOString(),
  });
}

export function verifyPaidContinuation(
  config: DeploymentEnvironment,
  token: string,
  expected: Omit<PaidContinuationScope, "chainId">,
  now: Date = new Date(),
): PaidContinuationScope {
  const required = requiredConfiguration(config);
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new PaidContinuationError("Paid continuation token is invalid");
  }
  let suppliedSignature: Buffer;
  try {
    suppliedSignature = Buffer.from(parts[1], "base64url");
  } catch {
    throw new PaidContinuationError("Paid continuation token is invalid");
  }
  const expectedSignature = signatureFor(required.agentApiKey, parts[0]);
  if (
    suppliedSignature.length !== expectedSignature.length ||
    !timingSafeEqual(suppliedSignature, expectedSignature)
  ) {
    throw new PaidContinuationError("Paid continuation token is invalid");
  }

  let payload: z.infer<typeof continuationPayloadSchema>;
  try {
    payload = continuationPayloadSchema.parse(
      JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")),
    );
  } catch {
    throw new PaidContinuationError("Paid continuation token is invalid");
  }
  if (
    payload.requestId !== expected.requestId ||
    payload.safeExitJobId !== expected.safeExitJobId ||
    payload.providerAgentId !== expected.providerAgentId ||
    payload.providerAgentId !== required.providerAgentId ||
    payload.issuedAt > now.getTime() + 60_000 ||
    payload.expiresAt <= now.getTime() ||
    payload.expiresAt - payload.issuedAt !== CONTINUATION_TTL_MS
  ) {
    throw new PaidContinuationError("Paid continuation token is expired or out of scope");
  }
  return {
    requestId: payload.requestId,
    safeExitJobId: payload.safeExitJobId,
    providerAgentId: payload.providerAgentId,
    chainId: payload.chainId,
  };
}
