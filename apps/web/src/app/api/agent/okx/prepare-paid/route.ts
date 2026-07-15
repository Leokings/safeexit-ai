import { withX402 } from "@okxweb3/x402-next";
import {
  okxX402PrepareRequestSchema,
  okxX402SigningDeliverableSchema,
} from "@safeexit/okx-transport";
import { parseJsonBody } from "@safeexit/security";
import { NextRequest, NextResponse } from "next/server";

import {
  agentErrorResponse,
  rateLimitAgentRequest,
} from "@/lib/agent-http";
import {
  answerAgentJobQuestion,
  SAFEEXIT_PAID_ANALYSIS_QUESTION,
} from "@/lib/agent-ai";
import { getAgentIncidentService } from "@/lib/agent-runtime";
import { parseDeploymentEnvironment } from "@/lib/deployment-env";
import {
  getOkxProviderBridge,
  normalizeOkxBridgeError,
} from "@/lib/okx-provider-bridge";
import {
  createSafeExitX402ResourceServer,
  createSafeExitX402RouteConfig,
  getSafeExitX402Configuration,
} from "@/lib/okx-x402";
import {
  hasX402PaymentHeader,
  inspectX402Payment,
} from "@/lib/okx-x402-request";
import { issuePaidContinuation } from "@/lib/paid-continuation";

export const runtime = "nodejs";
export const maxDuration = 60;

function asNextResponse(response: Response): NextResponse {
  return new NextResponse(response.body, {
    status: response.status,
    headers: response.headers,
  });
}

async function preparePaidRescue(request: NextRequest): Promise<NextResponse> {
  const startedAt = performance.now();
  try {
    const input = await parseJsonBody(request, okxX402PrepareRequestSchema);
    const environment = parseDeploymentEnvironment();
    const service = getAgentIncidentService({
      chainId: input.walletContext.chainId,
      ...(input.assetManifest ? { assetManifest: input.assetManifest } : {}),
    });
    const deliverable = await getOkxProviderBridge().preparePaidSigningDeliverable(
      service,
      input,
    );
    const job = await service.getJob(deliverable.safeExitJobId);
    if (!job.incident) {
      throw new Error("Paid SAFEEXIT job is missing its incident scope");
    }
    const analysis = await answerAgentJobQuestion(
      job,
      SAFEEXIT_PAID_ANALYSIS_QUESTION,
      environment,
    );
    const response = okxX402SigningDeliverableSchema.parse({
      ...deliverable,
      dashboardUrl: new URL(
        `/rescue/${encodeURIComponent(job.incident.id)}`,
        environment.publicBaseUrl,
      ).toString(),
      continuation: issuePaidContinuation(environment, {
        requestId: input.requestId,
        safeExitJobId: deliverable.safeExitJobId,
        providerAgentId: deliverable.providerAgentId,
        chainId: deliverable.walletContext.chainId,
      }),
      incidentAnalysis: {
        authority: "EXPLANATION_ONLY",
        executablePlanSource: "DETERMINISTIC",
        mode: analysis.mode,
        fallbackUsed: analysis.fallbackUsed,
        ...(environment.aiMode === "GATEWAY" && environment.aiModel
          ? { modelId: environment.aiModel }
          : {}),
        response: analysis.response,
      },
    });
    const durationMs = Math.round(performance.now() - startedAt);
    return NextResponse.json(
      response,
      {
        status: 200,
        headers: {
          "Cache-Control": "no-store",
          "Server-Timing": `safeexit;dur=${durationMs}`,
          "X-SafeExit-Execution-Mode": "deterministic-plan-grounded-analysis",
          "X-SafeExit-Analysis-Mode": analysis.mode.toLowerCase(),
        },
      },
    );
  } catch (error) {
    return asNextResponse(
      agentErrorResponse(normalizeOkxBridgeError(error)),
    );
  }
}

async function describePaidRescue(): Promise<NextResponse> {
  return NextResponse.json(
    {
      service: "Direct Rescue Preparation",
      method: "POST",
      execution: "PREPARE_ONLY",
      message:
        "Submit the validated SAFEEXIT request body with POST to prepare deterministic signing packages, a grounded incident explanation, and a payment-bound refresh continuation.",
    },
    { status: 200, headers: { "Cache-Control": "no-store", Allow: "POST" } },
  );
}

function createPaidHandler(
  handler: (request: NextRequest) => Promise<NextResponse>,
) {
  try {
    const environment = parseDeploymentEnvironment();
    const configuration = getSafeExitX402Configuration(environment);
    return withX402(
      handler,
      createSafeExitX402RouteConfig(configuration),
      createSafeExitX402ResourceServer(environment),
    );
  } catch {
    return async (): Promise<NextResponse> =>
      NextResponse.json(
        {
          code: "PAID_SERVICE_NOT_CONFIGURED",
          message: "The paid SAFEEXIT endpoint is not configured",
        },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
  }
}

function rateLimitBeforePayment(
  handler: (request: NextRequest) => Promise<NextResponse>,
  scope: string,
) {
  return async (request: NextRequest): Promise<NextResponse> => {
    let headers: Record<string, string> = {};
    try {
      headers = await rateLimitAgentRequest(request, scope);
    } catch (error) {
      return asNextResponse(agentErrorResponse(error, headers));
    }
    const response = await handler(request);
    for (const [name, value] of Object.entries(headers)) {
      response.headers.set(name, value);
    }
    return response;
  };
}

function observePaidHandler(
  handler: (request: NextRequest) => Promise<NextResponse>,
) {
  return async (request: NextRequest): Promise<NextResponse> => {
    const startedAt = performance.now();
    const payment = inspectX402Payment(request.headers);
    const response =
      payment.kind === "SELF_PAYMENT"
        ? NextResponse.json(
            {
              code: "X402_SELF_PAYMENT_UNSUPPORTED",
              message:
                "The x402 payer and SAFEEXIT payout wallet must be different addresses.",
            },
            {
              status: 409,
              headers: {
                "Cache-Control": "no-store",
                "X-SafeExit-Payment-Status": "rejected-self-payment",
              },
            },
          )
        : await handler(request);

    console.info(
      JSON.stringify({
        event: "safeexit_x402_request",
        method: request.method,
        status: response.status,
        hasPayment: hasX402PaymentHeader(request.headers),
        paymentInspection: payment.kind,
        durationMs: Math.round(performance.now() - startedAt),
      }),
    );
    return response;
  };
}

// OKX discovers x402 pricing with GET. The paid operation itself remains POST-only.
export const GET = observePaidHandler(
  rateLimitBeforePayment(createPaidHandler(describePaidRescue), "paid-discovery"),
);
export const POST = observePaidHandler(
  rateLimitBeforePayment(createPaidHandler(preparePaidRescue), "paid-prepare"),
);
