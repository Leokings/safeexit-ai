import { z } from "zod";

import {
  aiChatResponseSchema,
} from "@safeexit/ai";
import { parseJsonBody } from "@safeexit/security";

import {
  agentErrorResponse,
  agentJson,
  authorizeAgentRequest,
} from "@/lib/agent-http";
import { answerAgentJobQuestion } from "@/lib/agent-ai";
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
    headers = await authorizeAgentRequest(request);
    const [{ id }, input] = await Promise.all([
      context.params,
      parseJsonBody(request, chatRequestSchema),
    ]);
    const job = await getAgentIncidentService().getJob(id);
    const config = parseDeploymentEnvironment();
    const answer = await answerAgentJobQuestion(job, input.question, config);
    return agentJson(
      {
        schemaVersion: input.schemaVersion,
        mode: answer.mode,
        fallbackUsed: answer.fallbackUsed,
        response: aiChatResponseSchema.parse(answer.response),
      },
      200,
      headers,
    );
  } catch (error) {
    return agentErrorResponse(error, headers);
  }
}
