import { describe, expect, it, vi } from "vitest";

import {
  groundedModelInputSchema,
  VercelGatewayIntentProvider,
  type AiUsageEvent,
} from "../src";

const input = groundedModelInputSchema.parse({
  instructionsVersion: "safeexit-grounding-v1" as const,
  question: "Explain the rescue plan",
  allowedTools: [
    "scan_wallet",
    "scan_approvals",
    "get_rescue_plan",
    "simulate_plan",
    "explain_action",
    "get_rescue_status",
  ],
  availableRecordIds: ["incident:1", "plan:1"],
});

describe("Vercel Gateway grounded provider", () => {
  it("records usage and returns only schema-validated intent selection", async () => {
    const events: AiUsageEvent[] = [];
    const generate = vi.fn(async () => ({
      output: {
        intent: "PLAN_EXPLANATION" as const,
        selectedRecordIds: ["plan:1"],
        requestedTool: "get_rescue_plan" as const,
      },
      usage: { inputTokens: 80, outputTokens: 12, totalTokens: 92 },
    }));
    const provider = new VercelGatewayIntentProvider(
      "provider/model",
      "job:1",
      { async record(event) { events.push(event); } },
      generate,
      () => new Date("2026-07-12T12:00:00.000Z"),
      () => "event-1",
    );

    await expect(provider.select(input)).resolves.toMatchObject({
      intent: "PLAN_EXPLANATION",
    });
    expect(events).toEqual([
      expect.objectContaining({
        id: "ai_usage:event-1",
        jobId: "job:1",
        modelId: "provider/model",
        inputTokens: 80,
        outputTokens: 12,
        totalTokens: 92,
      }),
    ]);
  });

  it("rejects model output that invents an unsupported tool", async () => {
    const provider = new VercelGatewayIntentProvider(
      "provider/model",
      "job:1",
      { async record() {} },
      async () => ({
        output: {
          intent: "PLAN_EXPLANATION",
          selectedRecordIds: [],
          requestedTool: "execute_contract",
        },
        usage: {},
      }),
    );
    await expect(provider.select(input)).rejects.toThrow();
  });
});
