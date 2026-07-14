import { randomUUID } from "node:crypto";

import { ZodError } from "zod";

import { getPrismaClient, PrismaSafeExitRepository } from "@safeexit/persistence";
import {
  ApiInputError,
  createIncidentRequestSchema,
  createSecureLogger,
  parseJsonBody,
} from "@safeexit/security";
import { incidentSchema } from "@safeexit/shared";

import { rateLimitPublicRequest } from "@/lib/agent-http";

export const runtime = "nodejs";

const logger = createSecureLogger();

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
  let rateHeaders: Record<string, string> = {};
  try {
    const rateLimit = await rateLimitPublicRequest(request, "incidents");
    rateHeaders = rateLimit.headers;
    if (!rateLimit.allowed) {
      return jsonResponse(
        { code: "RATE_LIMITED", message: "Too many incident requests" },
        429,
        rateHeaders,
      );
    }
  } catch {
    return jsonResponse(
      {
        code: "RATE_LIMIT_UNAVAILABLE",
        message: "Incident request protection is temporarily unavailable",
      },
      503,
    );
  }

  try {
    const input = await parseJsonBody(request, createIncidentRequestSchema);
    if (input.chainId !== 196) {
      return jsonResponse(
        {
          code: "UNSUPPORTED_CHAIN",
          message: "SAFEEXIT currently supports X Layer mainnet (chain 196) only",
        },
        422,
        rateHeaders,
      );
    }
    const now = new Date().toISOString();
    const incident = incidentSchema.parse({
      id: `incident_${randomUUID()}`,
      chainId: input.chainId,
      sourceAddress: input.sourceAddress,
      destinationAddress: input.destinationAddress,
      assetManifest: input.assetManifest,
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
