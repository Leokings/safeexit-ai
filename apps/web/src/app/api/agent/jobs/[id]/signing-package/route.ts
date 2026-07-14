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
    headers = await authorizeAgentRequest(request);
    const input = await parseJsonBody(request, signingPackageRequestSchema);
    const signingPackages = await getAgentIncidentService().getSigningPackages(
      (await context.params).id,
    );
    const signingPackage = signingPackages[0];
    if (!signingPackage) {
      throw new Error("No supported signing package was prepared");
    }
    return agentJson(
      signingPackageResponseSchema.parse({
        schemaVersion: input.schemaVersion,
        signingPackage,
        signingPackages,
      }),
      200,
      headers,
    );
  } catch (error) {
    return agentErrorResponse(error, headers);
  }
}
