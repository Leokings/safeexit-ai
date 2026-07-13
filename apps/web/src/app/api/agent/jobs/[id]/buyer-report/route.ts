import {
  agentJobResponseSchema,
  buyerExecutionReportRequestSchema,
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
    const input = await parseJsonBody(request, buyerExecutionReportRequestSchema);
    const job = await getAgentIncidentService().recordBuyerExecutionReport(
      (await context.params).id,
      input.report,
    );
    return agentJson(
      agentJobResponseSchema.parse({ schemaVersion: input.schemaVersion, job }),
      200,
      headers,
    );
  } catch (error) {
    return agentErrorResponse(error, headers);
  }
}
