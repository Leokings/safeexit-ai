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
    expect(generate).toHaveBeenCalledWith(
      "provider/model",
      input,
      {
        maxEstimatedInputTokens: 12_000,
        maxOutputTokens: 256,
        timeoutMs: 8_000,
      },
    );
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
    const events: AiUsageEvent[] = [];
    const provider = new VercelGatewayIntentProvider(
      "provider/model",
      "job:1",
      { async record(event) { events.push(event); } },
      async () => ({
        output: {
          intent: "PLAN_EXPLANATION",
          selectedRecordIds: [],
          requestedTool: "execute_contract",
        },
        usage: { inputTokens: 40, outputTokens: 9, totalTokens: 49 },
      }),
    );
    await expect(provider.select(input)).rejects.toThrow();
    expect(events).toEqual([
      expect.objectContaining({ inputTokens: 40, outputTokens: 9, totalTokens: 49 }),
    ]);
  });

  it("fails before generation when the grounded input exceeds its budget", async () => {
    const generate = vi.fn(async () => ({
      output: {
        intent: "INCIDENT_REPORT" as const,
        selectedRecordIds: [],
        requestedTool: undefined,
      },
      usage: {},
    }));
    const provider = new VercelGatewayIntentProvider(
      "provider/model",
      "job:1",
      { async record() {} },
      generate,
      undefined,
      undefined,
      {
        maxEstimatedInputTokens: 512,
        maxOutputTokens: 64,
        timeoutMs: 1_000,
      },
    );
    const oversizedInput = groundedModelInputSchema.parse({
      ...input,
      question: "x".repeat(1_000),
      availableRecordIds: Array.from(
        { length: 256 },
        (_, index) => `record:${index.toString().padStart(3, "0")}`,
      ),
    });

    await expect(provider.select(oversizedInput)).rejects.toThrow("token budget");
    expect(generate).not.toHaveBeenCalled();
  });
});
