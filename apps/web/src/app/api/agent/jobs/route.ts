import { randomUUID } from "node:crypto";

import {
  agentJobResponseSchema,
  createAgentJobRequestSchema,
} from "@safeexit/agent-service";
import { parseJsonBody } from "@safeexit/security";
import { incidentSchema } from "@safeexit/shared";

import {
  agentErrorResponse,
  agentJson,
  authorizeAgentRequest,
} from "@/lib/agent-http";
import { getAgentIncidentService } from "@/lib/agent-runtime";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  let headers: Record<string, string> = {};
  try {
    headers = authorizeAgentRequest(request);
    const input = await parseJsonBody(request, createAgentJobRequestSchema);
    const now = new Date().toISOString();
    const incident = input.walletContext
      ? incidentSchema.parse({
          id: `incident_${randomUUID()}`,
          chainId: input.walletContext.chainId,
          sourceAddress: input.walletContext.sourceAddress,
          destinationAddress: input.walletContext.destinationAddress,
          status: "RECEIVED",
          ownershipAttestation: {
            accepted: input.walletContext.authorizationConfirmed,
            statementVersion: "safeexit-auth-v1",
            attestedAt: now,
          },
          createdAt: now,
          updatedAt: now,
        })
      : undefined;
    const service = getAgentIncidentService();
    let job = await service.createIncident({
      ...(input.requestId ? { requestId: input.requestId } : {}),
      ...(incident ? { incident } : {}),
    });
    await service.getDashboardUrl(job.id);
    job = await service.getJob(job.id);
    return agentJson(
      agentJobResponseSchema.parse({ schemaVersion: input.schemaVersion, job }),
      201,
      headers,
    );
  } catch (error) {
    return agentErrorResponse(error, headers);
  }
}
