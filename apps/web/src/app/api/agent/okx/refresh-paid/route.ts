import {
  okxX402RefreshRequestSchema,
  okxX402SigningDeliverableSchema,
} from "@safeexit/okx-transport";
import { parseJsonBody } from "@safeexit/security";

import {
  AgentHttpError,
  agentErrorResponse,
  agentJson,
  rateLimitPublicRequest,
} from "@/lib/agent-http";
import { getAgentIncidentService } from "@/lib/agent-runtime";
import { parseDeploymentEnvironment } from "@/lib/deployment-env";
import {
  getOkxProviderBridge,
  normalizeOkxBridgeError,
} from "@/lib/okx-provider-bridge";
import {
  PaidContinuationError,
  issuePaidContinuation,
  verifyPaidContinuation,
} from "@/lib/paid-continuation";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request): Promise<Response> {
  const startedAt = performance.now();
  let headers: Record<string, string> = {};
  try {
    const rateLimit = await rateLimitPublicRequest(request, "paid-continuation", 12);
    headers = rateLimit.headers;
    if (!rateLimit.allowed) {
      throw new AgentHttpError(
        429,
        "RATE_LIMITED",
        "Too many signing-package refresh requests",
        headers,
      );
    }
    const input = await parseJsonBody(request, okxX402RefreshRequestSchema);
    const environment = parseDeploymentEnvironment();
    const providerAgentId = environment.okxProviderAgentId;
    if (!providerAgentId) {
      throw new AgentHttpError(
        503,
        "OKX_PROVIDER_BRIDGE_NOT_CONFIGURED",
        "OKX provider bridge is not configured for this deployment",
      );
    }
    const scope = verifyPaidContinuation(
      environment,
      input.continuationToken,
      {
        requestId: input.requestId,
        safeExitJobId: input.safeExitJobId,
        providerAgentId,
      },
    );
    const service = getAgentIncidentService({ chainId: scope.chainId });
    const deliverable = await getOkxProviderBridge().refreshPaidSigningDeliverable(
      service,
      input,
    );
    const job = await service.getJob(deliverable.safeExitJobId);
    if (!job.incident) {
      throw new Error("Paid SAFEEXIT job is missing its incident scope");
    }
    const response = okxX402SigningDeliverableSchema.parse({
      ...deliverable,
      dashboardUrl: new URL(
        `/rescue/${encodeURIComponent(job.incident.id)}`,
        environment.publicBaseUrl,
      ).toString(),
      continuation: issuePaidContinuation(environment, scope),
    });
    return agentJson(response, 200, {
      ...headers,
      "Server-Timing": `safeexit-refresh;dur=${Math.round(performance.now() - startedAt)}`,
      "X-SafeExit-Payment-Status": "continued-original-payment",
    });
  } catch (error) {
    const normalized = error instanceof PaidContinuationError
      ? new AgentHttpError(401, "INVALID_CONTINUATION", error.message)
      : normalizeOkxBridgeError(error);
    return agentErrorResponse(normalized, headers);
  }
}
