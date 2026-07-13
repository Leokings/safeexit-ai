import { z } from "zod";

import {
  aiIntentSchema,
  aiToolNameSchema,
  groundedModelInputSchema,
  groundedSelectionSchema,
  type GroundedModelInput,
} from "./schemas";
import type { GroundedIntentProvider } from "./provider";

export const aiUsageEventSchema = z.strictObject({
  id: z.string().min(1).max(256),
  jobId: z.string().min(1).max(256),
  providerId: z.string().min(1).max(128),
  modelId: z.string().min(1).max(128),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
  createdAt: z.string().datetime({ offset: true }),
});

export type AiUsageEvent = z.infer<typeof aiUsageEventSchema>;

export interface AiUsageSink {
  record(event: AiUsageEvent): Promise<void>;
}

export type GatewayGeneration = {
  output: unknown;
  usage: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
};

export const gatewayIntentBudgetSchema = z.strictObject({
  maxEstimatedInputTokens: z.number().int().min(512).max(32_000),
  maxOutputTokens: z.number().int().min(32).max(512),
  timeoutMs: z.number().int().min(1_000).max(15_000),
});

export type GatewayIntentBudget = z.infer<typeof gatewayIntentBudgetSchema>;

export const DEFAULT_GATEWAY_INTENT_BUDGET: GatewayIntentBudget = {
  maxEstimatedInputTokens: 12_000,
  maxOutputTokens: 256,
  timeoutMs: 8_000,
};

export type GatewayGenerator = (
  modelId: string,
  input: GroundedModelInput,
  budget: GatewayIntentBudget,
) => Promise<GatewayGeneration>;

const gatewaySelectionSchema = z.strictObject({
  intent: aiIntentSchema,
  selectedRecordIds: z.array(z.string().min(1).max(256)).max(64),
  requestedTool: aiToolNameSchema.nullable(),
});

const GATEWAY_SYSTEM_INSTRUCTIONS =
  "Select only an allowed SAFEEXIT intent, optional allowed tool, and IDs present in availableRecordIds. Never invent blockchain state, addresses, calls, or transaction data.";

async function defaultGatewayGenerator(
  modelId: string,
  input: GroundedModelInput,
  budget: GatewayIntentBudget,
): Promise<GatewayGeneration> {
  const { generateText, Output } = await import("ai");
  const result = await generateText({
    model: modelId,
    system: GATEWAY_SYSTEM_INSTRUCTIONS,
    prompt: JSON.stringify(input),
    output: Output.object({ schema: gatewaySelectionSchema }),
    maxOutputTokens: budget.maxOutputTokens,
    temperature: 0,
    abortSignal: AbortSignal.timeout(budget.timeoutMs),
    providerOptions: {
      openai: {
        reasoningEffort: "low",
      },
      gateway: {
        user: input.availableRecordIds[0] ?? "safeexit",
        tags: ["app:safeexit", "feature:grounded-intent"],
      },
    },
  });
  const wireOutput = gatewaySelectionSchema.parse(result.output);
  return {
    output: groundedSelectionSchema.parse({
      intent: wireOutput.intent,
      selectedRecordIds: wireOutput.selectedRecordIds,
      ...(wireOutput.requestedTool ? { requestedTool: wireOutput.requestedTool } : {}),
    }),
    usage: {
      ...(result.totalUsage.inputTokens !== undefined
        ? { inputTokens: result.totalUsage.inputTokens }
        : {}),
      ...(result.totalUsage.outputTokens !== undefined
        ? { outputTokens: result.totalUsage.outputTokens }
        : {}),
      ...(result.totalUsage.totalTokens !== undefined
        ? { totalTokens: result.totalUsage.totalTokens }
        : {}),
    },
  };
}

export function estimateGatewayInputTokens(input: GroundedModelInput): number {
  return Math.ceil((GATEWAY_SYSTEM_INSTRUCTIONS.length + JSON.stringify(input).length) / 4);
}

export class VercelGatewayIntentProvider implements GroundedIntentProvider {
  readonly id = "vercel-ai-gateway-grounded-intent-v1";
  private readonly budget: GatewayIntentBudget;

  constructor(
    private readonly modelId: string,
    private readonly jobId: string,
    private readonly usageSink: AiUsageSink,
    private readonly generate: GatewayGenerator = defaultGatewayGenerator,
    private readonly clock: () => Date = () => new Date(),
    private readonly idFactory: () => string = () => crypto.randomUUID(),
    budget: GatewayIntentBudget = DEFAULT_GATEWAY_INTENT_BUDGET,
  ) {
    if (!modelId.includes("/")) {
      throw new Error("AI Gateway model IDs must use provider/model format");
    }
    this.budget = gatewayIntentBudgetSchema.parse(budget);
  }

  async select(value: GroundedModelInput): Promise<unknown> {
    const input = groundedModelInputSchema.parse(value);
    const estimatedInputTokens = estimateGatewayInputTokens(input);
    if (estimatedInputTokens > this.budget.maxEstimatedInputTokens) {
      throw new Error("AI Gateway input exceeds the configured token budget");
    }
    const result = await this.generate(this.modelId, input, this.budget);
    const inputTokens = result.usage.inputTokens ?? 0;
    const outputTokens = result.usage.outputTokens ?? 0;
    await this.usageSink.record(
      aiUsageEventSchema.parse({
        id: `ai_usage:${this.idFactory()}`,
        jobId: this.jobId,
        providerId: this.id,
        modelId: this.modelId,
        inputTokens,
        outputTokens,
        totalTokens: result.usage.totalTokens ?? inputTokens + outputTokens,
        createdAt: this.clock().toISOString(),
      }),
    );
    return groundedSelectionSchema.parse(result.output);
  }
}
