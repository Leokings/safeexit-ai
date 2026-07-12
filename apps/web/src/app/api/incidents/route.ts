import { createHash, randomUUID } from "node:crypto";

import { ZodError } from "zod";

import { getPrismaClient, PrismaSafeExitRepository } from "@safeexit/persistence";
import {
  ApiInputError,
  createIncidentRequestSchema,
  createSecureLogger,
  InMemoryRateLimiter,
  parseApiSecurityEnvironment,
  parseJsonBody,
} from "@safeexit/security";
import { incidentSchema } from "@safeexit/shared";

export const runtime = "nodejs";

const securityConfig = parseApiSecurityEnvironment(process.env);
const rateLimiter = new InMemoryRateLimiter(
  securityConfig.maxRequests,
  securityConfig.windowMs,
);
const logger = createSecureLogger();

function clientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const address = forwarded || request.headers.get("x-real-ip") || "unknown";
  return createHash("sha256").update(address.slice(0, 256)).digest("hex");
}

function jsonResponse(
  body: unknown,
  status: number,
  extraHeaders: Record<string, string> = {},
): Response {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      ...extraHeaders,
    },
  });
}

export async function POST(request: Request): Promise<Response> {
  const decision = rateLimiter.consume(clientKey(request));
  const rateHeaders = {
    "RateLimit-Limit": String(decision.limit),
    "RateLimit-Remaining": String(decision.remaining),
    "RateLimit-Reset": String(Math.ceil(decision.resetAt / 1_000)),
  };
  if (!decision.allowed) {
    return jsonResponse(
      { code: "RATE_LIMITED", message: "Too many incident requests" },
      429,
      rateHeaders,
    );
  }

  try {
    const input = await parseJsonBody(request, createIncidentRequestSchema);
    const now = new Date().toISOString();
    const incident = incidentSchema.parse({
      id: `incident_${randomUUID()}`,
      chainId: input.chainId,
      sourceAddress: input.sourceAddress,
      destinationAddress: input.destinationAddress,
      status: "RECEIVED",
      ownershipAttestation: {
        accepted: input.authorizationConfirmed,
        statementVersion: "safeexit-auth-v1",
        attestedAt: now,
      },
      createdAt: now,
      updatedAt: now,
    });

    const repository = new PrismaSafeExitRepository(getPrismaClient());
    await repository.saveIncident(incident);
    return jsonResponse(
      {
        incidentId: incident.id,
        status: incident.status,
        dashboardUrl: `/rescue/${incident.id}`,
      },
      201,
      rateHeaders,
    );
  } catch (error) {
    if (error instanceof ApiInputError) {
      return jsonResponse(
        {
          code: error.code,
          message: error.message,
          ...(error.issues ? { issues: error.issues } : {}),
        },
        error.status,
        rateHeaders,
      );
    }
    if (error instanceof ZodError) {
      logger.warn("Persistence configuration is unavailable", {
        code: "PERSISTENCE_NOT_CONFIGURED",
      });
      return jsonResponse(
        {
          code: "PERSISTENCE_NOT_CONFIGURED",
          message: "PostgreSQL persistence is not configured for this environment",
        },
        503,
        rateHeaders,
      );
    }

    logger.error("Incident persistence failed", { error });
    return jsonResponse(
      {
        code: "PERSISTENCE_UNAVAILABLE",
        message: "Incident persistence is temporarily unavailable",
      },
      503,
      rateHeaders,
    );
  }
}
