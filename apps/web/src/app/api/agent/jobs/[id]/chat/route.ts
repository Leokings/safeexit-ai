import { z } from "zod";

import {
  aiChatResponseSchema,
  answerIncidentQuestion,
  answerIncidentQuestionWithProvider,
  VercelGatewayIntentProvider,
} from "@safeexit/ai";
import { getPrismaClient, PrismaAiUsageSink } from "@safeexit/persistence";
import { parseJsonBody } from "@safeexit/security";

import {
  agentErrorResponse,
  agentJson,
  authorizeAgentRequest,
} from "@/lib/agent-http";
import { getAgentIncidentService } from "@/lib/agent-runtime";
import { parseDeploymentEnvironment } from "@/lib/deployment-env";

export const runtime = "nodejs";

const chatRequestSchema = z.strictObject({
  schemaVersion: z.literal("safeexit-agent-api-v1"),
  question: z.string().trim().min(1).max(1_000),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  let headers: Record<string, string> = {};
  try {
    headers = authorizeAgentRequest(request);
    const [{ id }, input] = await Promise.all([
      context.params,
      parseJsonBody(request, chatRequestSchema),
    ]);
    const job = await getAgentIncidentService().getJob(id);
    if (!job.incident || !job.scan) {
      throw new Error("Wallet analysis is required before grounded chat");
    }
    const aiContext = {
      incident: job.incident,
      scan: job.scan,
      ...(job.plan ? { plan: job.plan } : {}),
      simulations: job.simulation?.results ?? [],
      status: {
        incidentId: job.incident.id,
        status: job.status,
        completedActionIds: job.monitor?.completedActionIds ?? [],
        failedActionIds: job.monitor?.failedActionIds ?? [],
        transactionHashes: job.monitor?.transactionHashes ?? [],
        observedAt: job.updatedAt,
      },
    };
    const config = parseDeploymentEnvironment();
    let response;
    let mode = "DETERMINISTIC";
    if (config.aiMode === "GATEWAY" && config.aiModel) {
      try {
        response = await answerIncidentQuestionWithProvider(
          { question: input.question, context: aiContext },
          new VercelGatewayIntentProvider(
            config.aiModel,
            job.id,
            new PrismaAiUsageSink(getPrismaClient()),
          ),
        );
        mode = "GATEWAY";
      } catch {
        response = answerIncidentQuestion({ question: input.question, context: aiContext });
      }
    } else {
      response = answerIncidentQuestion({ question: input.question, context: aiContext });
    }
    return agentJson(
      { schemaVersion: input.schemaVersion, mode, response: aiChatResponseSchema.parse(response) },
      200,
      headers,
    );
  } catch (error) {
    return agentErrorResponse(error, headers);
  }
}
