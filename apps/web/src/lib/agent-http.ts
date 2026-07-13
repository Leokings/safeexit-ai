import { createHash, timingSafeEqual } from "node:crypto";

import { ZodError } from "zod";

import {
  ApiInputError,
  createSecureLogger,
  InMemoryRateLimiter,
  parseApiSecurityEnvironment,
} from "@safeexit/security";

import { parseDeploymentEnvironment } from "./deployment-env";

const securityConfig = parseApiSecurityEnvironment(process.env);
const rateLimiter = new InMemoryRateLimiter(
  securityConfig.maxRequests,
  securityConfig.windowMs,
);
const logger = createSecureLogger();

export class AgentHttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "AgentHttpError";
  }
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

function clientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const address = forwarded || request.headers.get("x-real-ip") || "unknown";
  return createHash("sha256").update(address.slice(0, 256)).digest("hex");
}

export function authorizeAgentRequest(request: Request): Record<string, string> {
  const config = parseDeploymentEnvironment();
  if (config.agentMode === "DISABLED" || !config.agentApiKey) {
    throw new AgentHttpError(
      503,
      "AGENT_SERVICE_NOT_CONFIGURED",
      "Agent service is not configured for this deployment",
    );
  }

  const authorization = request.headers.get("authorization");
  const supplied = authorization?.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : "";
  const expectedDigest = digest(config.agentApiKey);
  const suppliedDigest = digest(supplied);
  if (!supplied || !timingSafeEqual(expectedDigest, suppliedDigest)) {
    throw new AgentHttpError(401, "UNAUTHORIZED", "Valid bearer authentication is required");
  }

  const decision = rateLimiter.consume(clientKey(request));
  const headers = {
    "RateLimit-Limit": String(decision.limit),
    "RateLimit-Remaining": String(decision.remaining),
    "RateLimit-Reset": String(Math.ceil(decision.resetAt / 1_000)),
  };
  if (!decision.allowed) {
    throw new AgentHttpError(429, "RATE_LIMITED", "Too many agent-service requests");
  }
  return headers;
}

export function agentJson(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store", ...headers },
  });
}

export function agentErrorResponse(
  error: unknown,
  headers: Record<string, string> = {},
): Response {
  if (error instanceof AgentHttpError) {
    return agentJson({ code: error.code, message: error.message }, error.status, headers);
  }
  if (error instanceof ApiInputError) {
    return agentJson(
      {
        code: error.code,
        message: error.message,
        ...(error.issues ? { issues: error.issues } : {}),
      },
      error.status,
      headers,
    );
  }
  if (error instanceof ZodError) {
    return agentJson(
      { code: "CONFIGURATION_INVALID", message: "Agent configuration is invalid" },
      503,
      headers,
    );
  }

  const message = error instanceof Error ? error.message : "Agent service request failed";
  const notFound = message.startsWith("Agent-service job not found:");
  const conflict =
    message.startsWith("Cannot ") ||
    message.startsWith("Signing package is unavailable:") ||
    message.includes(" is required before ");
  logger.error("Agent service request failed", { error });
  return agentJson(
    {
      code: notFound ? "JOB_NOT_FOUND" : conflict ? "INVALID_JOB_STATE" : "AGENT_SERVICE_UNAVAILABLE",
      message: notFound
        ? "Agent-service job was not found"
        : conflict
          ? message
          : "Agent service is temporarily unavailable",
    },
    notFound ? 404 : conflict ? 409 : 503,
    headers,
  );
}
