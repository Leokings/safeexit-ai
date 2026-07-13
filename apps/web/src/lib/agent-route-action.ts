import {
  agentJobActionRequestSchema,
  analyseAgentJobRequestSchema,
  agentJobResponseSchema,
} from "@safeexit/agent-service";
import { parseJsonBody } from "@safeexit/security";

import {
  agentErrorResponse,
  agentJson,
  authorizeAgentRequest,
} from "./agent-http";
import { getAgentIncidentService } from "./agent-runtime";

export type AgentJobAction = "analyse" | "plan" | "simulate" | "monitor";

export async function runAgentJobAction(
  action: AgentJobAction,
  request: Request,
  jobId: string,
): Promise<Response> {
  let headers: Record<string, string> = {};
  try {
    headers = await authorizeAgentRequest(request);
    const service = getAgentIncidentService();
    let job;
    if (action === "analyse") {
      const input = await parseJsonBody(request, analyseAgentJobRequestSchema);
      job = await service.analyseIncident(jobId, input.incident);
    } else {
      await parseJsonBody(request, agentJobActionRequestSchema);
      if (action === "plan") {
        job = await service.generatePlan(jobId);
      } else if (action === "simulate") {
        job = await service.simulatePlan(jobId);
      } else {
        job = await service.monitorRescue(jobId);
      }
    }
    return agentJson(
      agentJobResponseSchema.parse({ schemaVersion: "safeexit-agent-api-v1", job }),
      200,
      headers,
    );
  } catch (error) {
    return agentErrorResponse(error, headers);
  }
}
