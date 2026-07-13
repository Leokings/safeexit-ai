import {
  agentJobActionRequestSchema,
  agentJobResponseSchema,
} from "@safeexit/agent-service";
import { parseJsonBody } from "@safeexit/security";

import {
  agentErrorResponse,
  agentJson,
  authorizeAgentRequest,
} from "@/lib/agent-http";
import { getAgentIncidentService } from "@/lib/agent-runtime";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  let headers: Record<string, string> = {};
  try {
    headers = await authorizeAgentRequest(request);
    const input = await parseJsonBody(request, agentJobActionRequestSchema);
    const service = getAgentIncidentService();
    const jobId = (await context.params).id;
    await service.getDashboardUrl(jobId);
    const job = await service.getJob(jobId);
    return agentJson(
      agentJobResponseSchema.parse({ schemaVersion: input.schemaVersion, job }),
      200,
      headers,
    );
  } catch (error) {
    return agentErrorResponse(error, headers);
  }
}
