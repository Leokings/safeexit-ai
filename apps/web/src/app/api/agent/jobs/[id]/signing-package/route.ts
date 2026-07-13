import {
  signingPackageRequestSchema,
  signingPackageResponseSchema,
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
    headers = authorizeAgentRequest(request);
    const input = await parseJsonBody(request, signingPackageRequestSchema);
    const signingPackage = await getAgentIncidentService().getSigningPackage(
      (await context.params).id,
    );
    return agentJson(
      signingPackageResponseSchema.parse({
        schemaVersion: input.schemaVersion,
        signingPackage,
      }),
      200,
      headers,
    );
  } catch (error) {
    return agentErrorResponse(error, headers);
  }
}
