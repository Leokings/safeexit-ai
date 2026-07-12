import { aiUsageEventSchema, type AiUsageEvent, type AiUsageSink } from "@safeexit/ai";

import type { PrismaClient } from "./generated/prisma/client";

export class PrismaAiUsageSink implements AiUsageSink {
  constructor(private readonly client: PrismaClient) {}

  async record(value: AiUsageEvent): Promise<void> {
    const event = aiUsageEventSchema.parse(value);
    await this.client.aiUsageEvent.create({
      data: {
        id: event.id,
        jobId: event.jobId,
        providerId: event.providerId,
        modelId: event.modelId,
        inputTokens: event.inputTokens,
        outputTokens: event.outputTokens,
        totalTokens: event.totalTokens,
        createdAt: new Date(event.createdAt),
      },
    });
  }
}
