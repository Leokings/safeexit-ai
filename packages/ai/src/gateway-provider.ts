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

export type GatewayGenerator = (
  modelId: string,
  input: GroundedModelInput,
) => Promise<GatewayGeneration>;

const gatewaySelectionSchema = z.strictObject({
  intent: aiIntentSchema,
  selectedRecordIds: z.array(z.string().min(1).max(256)).max(64),
  requestedTool: aiToolNameSchema.nullable(),
});

async function defaultGatewayGenerator(
  modelId: string,
  input: GroundedModelInput,
): Promise<GatewayGeneration> {
  const { generateText, Output } = await import("ai");
  const result = await generateText({
    model: modelId,
    system:
      "Select only an allowed SAFEEXIT intent, optional allowed tool, and IDs present in availableRecordIds. Never invent blockchain state, addresses, calls, or transaction data.",
    prompt: JSON.stringify(input),
    output: Output.object({ schema: gatewaySelectionSchema }),
    maxOutputTokens: 512,
    temperature: 0,
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

export class VercelGatewayIntentProvider implements GroundedIntentProvider {
  readonly id = "vercel-ai-gateway-grounded-intent-v1";

  constructor(
    private readonly modelId: string,
    private readonly jobId: string,
    private readonly usageSink: AiUsageSink,
    private readonly generate: GatewayGenerator = defaultGatewayGenerator,
    private readonly clock: () => Date = () => new Date(),
    private readonly idFactory: () => string = () => crypto.randomUUID(),
  ) {
    if (!modelId.includes("/")) {
      throw new Error("AI Gateway model IDs must use provider/model format");
    }
  }

  async select(value: GroundedModelInput): Promise<unknown> {
    const input = groundedModelInputSchema.parse(value);
    const result = await this.generate(this.modelId, input);
    const output = groundedSelectionSchema.parse(result.output);
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
    return output;
  }
}
