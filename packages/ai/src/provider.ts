import {
  aiChatRequestSchema,
  groundedModelInputSchema,
  groundedSelectionSchema,
  type AiChatResponse,
  type GroundedModelInput,
  type GroundedSelection,
} from "./schemas";
import { answerIncidentQuestion } from "./explanations";
import { SAFEEXIT_AI_TOOL_NAMES } from "./tools";

export interface GroundedIntentProvider {
  readonly id: string;
  select(input: GroundedModelInput): Promise<unknown>;
}

function collectRecordIds(context: ReturnType<typeof aiChatRequestSchema.parse>["context"]): string[] {
  return [
    context.incident.id,
    context.scan.id,
    ...context.scan.assets.map((asset) => asset.id),
    ...context.scan.approvals.map((approval) => approval.id),
    ...(context.plan ? [context.plan.id, ...context.plan.actions.map((action) => action.id)] : []),
    ...context.simulations.map((simulation) => simulation.id),
    context.status.incidentId,
  ];
}

// The provider selects intent and existing record IDs only. It never authors display prose.
export async function answerIncidentQuestionWithProvider(
  value: Omit<ReturnType<typeof aiChatRequestSchema.parse>, "selection">,
  provider: GroundedIntentProvider,
): Promise<AiChatResponse> {
  const request = aiChatRequestSchema.parse(value);
  const modelInput = groundedModelInputSchema.parse({
    instructionsVersion: "safeexit-grounding-v1",
    question: request.question,
    allowedTools: SAFEEXIT_AI_TOOL_NAMES,
    availableRecordIds: collectRecordIds(request.context),
  });
  const selection: GroundedSelection = groundedSelectionSchema.parse(
    await provider.select(modelInput),
  );

  return answerIncidentQuestion({ ...request, selection });
}
