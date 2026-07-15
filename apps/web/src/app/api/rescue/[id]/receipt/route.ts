import { after, NextResponse } from "next/server";
import { TransactionNotFoundError, type Hex } from "viem";

import { buyerReceiptRegistrationSchema } from "@safeexit/agent-service";
import {
  createDedicatedPublicClient,
  getRescueMainnetChainConfig,
} from "@safeexit/chain";
import {
  getPrismaClient,
  PrismaAgentServiceJobStore,
} from "@safeexit/persistence";
import { parseJsonBody } from "@safeexit/security";

import {
  AgentHttpError,
  agentErrorResponse,
  rateLimitPublicRequest,
} from "@/lib/agent-http";
import { getAgentIncidentService } from "@/lib/agent-runtime";
import { assertReceiptSubmissionTransaction } from "@/lib/buyer-receipt-registration";
import {
  getDeploymentRpcUrl,
  parseDeploymentEnvironment,
} from "@/lib/deployment-env";

export const runtime = "nodejs";
export const maxDuration = 60;

type RouteContext = { params: Promise<{ id: string }> };

function asNextResponse(response: Response): NextResponse {
  return new NextResponse(response.body, {
    status: response.status,
    headers: response.headers,
  });
}

async function continueReconciliation(
  jobId: string,
  chainId: number,
  input: { packageId: string; transactionHash: string },
): Promise<void> {
  const service = getAgentIncidentService({ chainId });
  for (let attempt = 0; attempt < 8; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5_000));
    try {
      const result = await service.reconcileBuyerReceiptSubmission(jobId, input);
      if (result.status !== "PENDING") {
        return;
      }
    } catch (error) {
      console.warn(JSON.stringify({
        event: "safeexit_receipt_reconciliation_retry_failed",
        jobId,
        message: error instanceof Error ? error.message.slice(0, 300) : "Unknown error",
      }));
    }
  }
}

async function getVisibleTransaction(
  chainId: number,
  transactionHash: string,
) {
  const config = parseDeploymentEnvironment();
  const chain = getRescueMainnetChainConfig(chainId);
  const rpcUrl = getDeploymentRpcUrl(config, chainId);
  if (!rpcUrl) {
    throw new AgentHttpError(503, "RPC_NOT_CONFIGURED", "Receipt verification RPC is unavailable");
  }
  const client = createDedicatedPublicClient(chain, rpcUrl);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      return await client.getTransaction({ hash: transactionHash as Hex });
    } catch (error) {
      if (
        !(error instanceof TransactionNotFoundError) &&
        !(error instanceof Error && error.name === "TransactionNotFoundError")
      ) {
        throw error;
      }
      if (attempt < 4) {
        await new Promise((resolve) => setTimeout(resolve, 750));
      }
    }
  }
  throw new AgentHttpError(
    409,
    "TRANSACTION_NOT_VISIBLE",
    "The submitted transaction is not visible on the configured chain yet; retry shortly",
  );
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  let headers: Record<string, string> = {};
  try {
    const rateLimit = await rateLimitPublicRequest(request, "receipt-registration", 12);
    headers = rateLimit.headers;
    if (!rateLimit.allowed) {
      throw new AgentHttpError(429, "RATE_LIMITED", "Too many receipt registration requests");
    }

    const input = await parseJsonBody(request, buyerReceiptRegistrationSchema);
    const incidentId = (await context.params).id;
    const jobStore = new PrismaAgentServiceJobStore(getPrismaClient());
    const existing = await jobStore.getByIncidentId(incidentId);
    if (!existing || !existing.incident) {
      throw new AgentHttpError(
        404,
        "AGENT_JOB_NOT_FOUND",
        "This incident is not linked to a SAFEEXIT agent job",
      );
    }

    const signingPackage = (
      existing.signingPackages ??
      (existing.signingPackage ? [existing.signingPackage] : [])
    ).find((candidate) => candidate.packageId === input.packageId);
    if (!signingPackage) {
      throw new AgentHttpError(
        409,
        "SIGNING_PACKAGE_MISMATCH",
        "Receipt submission does not reference an issued signing package",
      );
    }
    const transaction = await getVisibleTransaction(
      existing.incident.chainId,
      input.transactionHash,
    );
    try {
      await assertReceiptSubmissionTransaction(signingPackage, {
        from: transaction.from,
        to: transaction.to,
        value: transaction.value,
        input: transaction.input,
      });
    } catch (error) {
      throw new AgentHttpError(
        409,
        "TRANSACTION_SCOPE_MISMATCH",
        error instanceof Error ? error.message : "Receipt transaction is outside the rescue scope",
      );
    }

    const service = getAgentIncidentService({ chainId: existing.incident.chainId });
    await service.recordBuyerReceiptSubmission(existing.id, input);
    const result = await service.reconcileBuyerReceiptSubmission(existing.id, input);
    if (result.status === "PENDING") {
      after(() => continueReconciliation(existing.id, existing.incident!.chainId, input));
    }

    const statusCode = result.status === "PENDING"
      ? 202
      : result.status === "CONFIRMED"
        ? 200
        : 422;
    return NextResponse.json(
      {
        status: result.status,
        jobStatus: result.job.status,
        transactionHash: input.transactionHash,
      },
      { status: statusCode, headers: { ...headers, "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return asNextResponse(agentErrorResponse(error, headers));
  }
}
