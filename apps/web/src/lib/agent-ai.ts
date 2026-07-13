import {
  aiChatResponseSchema,
  aiIncidentContextSchema,
  answerIncidentQuestion,
  answerIncidentQuestionWithProvider,
  VercelGatewayIntentProvider,
  type AiChatResponse,
  type GroundedIntentProvider,
} from "@safeexit/ai";
import type { AgentServiceJob } from "@safeexit/agent-service";
import { getPrismaClient, PrismaAiUsageSink } from "@safeexit/persistence";

import type { DeploymentEnvironment } from "./deployment-env";

export const SAFEEXIT_PAID_ANALYSIS_QUESTION =
  "Summarize the incident, the supported rescue plan, simulation status, and recorded limitations.";

export type AgentAiAnswer = {
  mode: "DETERMINISTIC" | "GATEWAY";
  fallbackUsed: boolean;
  response: AiChatResponse;
};

type AgentAiOptions = {
  provider?: GroundedIntentProvider;
  onGatewayFallback?: (metadata: Record<string, string | number>) => void;
};

function describeGatewayError(error: unknown): Record<string, string | number> {
  if (!error || typeof error !== "object") {
    return { name: "UnknownError" };
  }
  const value = error as { name?: unknown; statusCode?: unknown; cause?: unknown };
  return {
    name: typeof value.name === "string" ? value.name : "UnknownError",
    ...(typeof value.statusCode === "number" ? { statusCode: value.statusCode } : {}),
    ...(value.cause instanceof Error ? { causeName: value.cause.name } : {}),
  };
}

export function createAgentAiContext(job: AgentServiceJob) {
  if (!job.incident || !job.scan) {
    throw new Error("Wallet analysis is required before grounded explanation");
  }
  return aiIncidentContextSchema.parse({
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
  });
}

export async function answerAgentJobQuestion(
  job: AgentServiceJob,
  question: string,
  config: DeploymentEnvironment,
  options: AgentAiOptions = {},
): Promise<AgentAiAnswer> {
  const context = createAgentAiContext(job);
  const deterministic = (): AgentAiAnswer => ({
    mode: "DETERMINISTIC",
    fallbackUsed: false,
    response: aiChatResponseSchema.parse(
      answerIncidentQuestion({ question, context }),
    ),
  });

  if (config.aiMode !== "GATEWAY" || !config.aiModel) {
    return deterministic();
  }

  try {
    const provider =
      options.provider ??
      new VercelGatewayIntentProvider(
        config.aiModel,
        job.id,
        new PrismaAiUsageSink(getPrismaClient()),
        undefined,
        undefined,
        undefined,
        {
          maxEstimatedInputTokens: config.aiMaxEstimatedInputTokens,
          maxOutputTokens: config.aiMaxOutputTokens,
          timeoutMs: config.aiTimeoutMs,
        },
      );
    return {
      mode: "GATEWAY",
      fallbackUsed: false,
      response: aiChatResponseSchema.parse(
        await answerIncidentQuestionWithProvider({ question, context }, provider),
      ),
    };
  } catch (error) {
    (options.onGatewayFallback ?? ((metadata) => {
      console.error("SAFEEXIT_AI_GATEWAY_FALLBACK", metadata);
    }))(describeGatewayError(error));
    return { ...deterministic(), fallbackUsed: true };
  }
}
