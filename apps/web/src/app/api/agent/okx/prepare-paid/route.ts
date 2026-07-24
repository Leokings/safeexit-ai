import {
  withX402FromHTTPServer,
  x402HTTPResourceServer,
} from "@okxweb3/x402-next";
import {
  okxX402PrepareRequestSchema,
} from "@safeexit/okx-transport";
import { parseJsonBody } from "@safeexit/security";
import { NextRequest, NextResponse } from "next/server";

import {
  agentErrorResponse,
  rateLimitAgentRequest,
} from "@/lib/agent-http";
import { parseDeploymentEnvironment } from "@/lib/deployment-env";
import { normalizeOkxBridgeError } from "@/lib/okx-provider-bridge";
import {
  createSafeExitX402PrepareRouteConfigs,
  createSafeExitX402ResourceServer,
  getSafeExitX402Configuration,
} from "@/lib/okx-x402";
import {
  describeX402PaymentFailure,
  hasX402PaymentHeader,
  inspectX402Payment,
  inspectX402PaymentResponse,
} from "@/lib/okx-x402-request";
import { preparePaidRescueDeliverable } from "@/lib/paid-rescue-preparation";
import {
  applySafeExitServiceDiscoveryHeaders,
  createSafeExitRequestExample,
  createSafeExitX402ChallengeJsonSchema,
  SAFEEXIT_PAID_PREPARE_PATH,
} from "@/lib/safeexit-service-discovery";

export const runtime = "nodejs";
export const maxDuration = 60;

type PaidHandler = (request: NextRequest) => Promise<NextResponse>;

function asNextResponse(response: Response): NextResponse {
  return new NextResponse(response.body, {
    status: response.status,
    headers: response.headers,
  });
}

async function preparePaidRescue(request: NextRequest): Promise<NextResponse> {
  try {
    const input = await parseJsonBody(request, okxX402PrepareRequestSchema);
    const deliverable = await preparePaidRescueDeliverable(input);
    return NextResponse.json(deliverable, {
      status: 200,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return asNextResponse(agentErrorResponse(normalizeOkxBridgeError(error)));
  }
}

async function requirePostReplay(): Promise<NextResponse> {
  return NextResponse.json(
    {
      code: "POST_REPLAY_REQUIRED",
      message:
        "The Safe Exit payment challenge declares a JSON POST. Submit the complete request body to this same endpoint; do not place wallet or asset details in a GET URL.",
      requestSchemaUrl: new URL(
        "/api/agent/okx/schema",
        parseDeploymentEnvironment().publicBaseUrl,
      ).toString(),
    },
    { status: 409, headers: { "Cache-Control": "no-store" } },
  );
}

function disabledHandler(): PaidHandler {
  return async (): Promise<NextResponse> =>
    NextResponse.json(
      {
        code: "PAID_SERVICE_NOT_CONFIGURED",
        message: "The paid SAFEEXIT endpoint is not configured",
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
}

function createPaidHandler(): PaidHandler {
  try {
    const environment = parseDeploymentEnvironment();
    const configuration = getSafeExitX402Configuration(environment);
    const httpServer = new x402HTTPResourceServer(
      createSafeExitX402ResourceServer(environment),
      createSafeExitX402PrepareRouteConfigs(
        SAFEEXIT_PAID_PREPARE_PATH,
        configuration,
        {
          schema: createSafeExitX402ChallengeJsonSchema(
            environment.publicBaseUrl,
          ),
          example: createSafeExitRequestExample(),
        },
      ),
    );
    return withX402FromHTTPServer(
      async (request) =>
        request.method === "POST"
          ? preparePaidRescue(request)
          : requirePostReplay(),
      httpServer,
    );
  } catch {
    return disabledHandler();
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
    let response =
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

    const paymentResponse =
      response.status === 402
        ? inspectX402PaymentResponse(response.headers)
        : { kind: "NONE" as const };
    const paymentFailure =
      paymentResponse.kind === "PAYMENT_REQUIRED"
        ? describeX402PaymentFailure(paymentResponse.error)
        : undefined;
    if (hasX402PaymentHeader(request.headers) && paymentFailure) {
      const headers = new Headers(response.headers);
      headers.set("Cache-Control", "no-store");
      response = NextResponse.json(paymentFailure, {
        status: 402,
        headers,
      });
    }

    response.headers.set("Cache-Control", "no-store");
    applySafeExitServiceDiscoveryHeaders(response.headers, request.url);
    console.info(
      JSON.stringify({
        event: "safeexit_x402_request",
        method: request.method,
        status: response.status,
        hasPayment: hasX402PaymentHeader(request.headers),
        paymentInspection: payment.kind,
        paymentResponse: paymentResponse.kind,
        ...(paymentResponse.kind === "PAYMENT_REQUIRED" && paymentResponse.error
          ? { paymentError: paymentResponse.error }
          : {}),
        durationMs: Math.round(performance.now() - startedAt),
      }),
    );
    return response;
  };
}

const paidHandler = createPaidHandler();

export const GET = observePaidHandler(
  rateLimitBeforePayment(paidHandler, "paid-prepare-get"),
);
export const POST = observePaidHandler(
  rateLimitBeforePayment(paidHandler, "paid-prepare"),
);
