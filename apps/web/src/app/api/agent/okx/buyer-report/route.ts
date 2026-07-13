import {
  okxA2ABuyerReportRequestSchema,
  okxA2ACompletionDeliverableSchema,
} from "@safeexit/okx-transport";
import { parseJsonBody } from "@safeexit/security";

import {
  agentErrorResponse,
  agentJson,
  authorizeAgentRequest,
} from "@/lib/agent-http";
import { getAgentIncidentService } from "@/lib/agent-runtime";
import {
  getOkxProviderBridge,
  normalizeOkxBridgeError,
} from "@/lib/okx-provider-bridge";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  let headers: Record<string, string> = {};
  try {
    headers = authorizeAgentRequest(request);
    const input = await parseJsonBody(request, okxA2ABuyerReportRequestSchema);
    const deliverable = await getOkxProviderBridge().recordBuyerReport(
      getAgentIncidentService({ chainId: input.report.chainId }),
      input,
    );
    return agentJson(okxA2ACompletionDeliverableSchema.parse(deliverable), 200, headers);
  } catch (error) {
    return agentErrorResponse(normalizeOkxBridgeError(error), headers);
  }
}
