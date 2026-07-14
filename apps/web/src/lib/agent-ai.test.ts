import { describe, expect, it, vi } from "vitest";

import { agentServiceJobSchema } from "@safeexit/agent-service";
import { incidentSchema, walletScanSchema } from "@safeexit/shared";

import { answerAgentJobQuestion, createAgentAiContext } from "./agent-ai";
import { parseDeploymentEnvironment } from "./deployment-env";

const now = "2026-07-13T12:00:00.000Z";
const source = "0x65804490935ef57818ab442c3bf866215bb1a4e7";
const destination = "0x4ab2b4be420a82031dc155c0be856ae383e0ba7e";

const incident = incidentSchema.parse({
  id: "incident:ai-test",
  chainId: 196,
  sourceAddress: source,
  destinationAddress: destination,
  status: "RECEIVED",
  ownershipAttestation: {
    accepted: true,
    statementVersion: "safeexit-ai-test-v1",
    attestedAt: now,
  },
  createdAt: now,
  updatedAt: now,
});

const scan = walletScanSchema.parse({
  id: "scan:ai-test",
  incidentId: incident.id,
  chainId: incident.chainId,
  address: source,
  status: "COMPLETE",
  providerId: "test-scanner",
  observedAtBlock: "42",
  observedAt: now,
  assets: [],
  approvals: [],
  warnings: [],
});

const job = agentServiceJobSchema.parse({
  id: "job:ai-test",
  service: "safeexit-incident-response",
  status: "ANALYSING",
  incident,
  scan,
  history: [
    { sequence: 0, from: null, to: "RECEIVED", reason: "JOB_CREATED", at: now },
    {
      sequence: 1,
      from: "RECEIVED",
      to: "ANALYSING",
      reason: "ANALYSIS_STARTED",
      at: now,
    },
  ],
  revision: 1,
  createdAt: now,
  updatedAt: now,
});

const gatewayConfig = parseDeploymentEnvironment({
  NODE_ENV: "test",
  SAFEEXIT_AI_MODE: "GATEWAY",
  SAFEEXIT_AI_MODEL: "deepseek/deepseek-v4-flash",
});

describe("hosted agent explanation", () => {
  it("gives the model only a grounded incident context and keeps execution authority deterministic", async () => {
    const select = vi.fn(async () => ({
      intent: "INCIDENT_REPORT" as const,
      selectedRecordIds: [incident.id, scan.id],
      requestedTool: "scan_wallet" as const,
    }));

    const answer = await answerAgentJobQuestion(
      job,
      "Summarize this incident",
      gatewayConfig,
      { provider: { id: "test-provider", select } },
    );

    expect(answer.mode).toBe("GATEWAY");
    expect(answer.fallbackUsed).toBe(false);
    expect(answer.response.explanation.kind).toBe("INCIDENT_REPORT");
    expect(select).toHaveBeenCalledWith(expect.objectContaining({
      availableRecordIds: expect.arrayContaining([incident.id, scan.id]),
      allowedTools: expect.not.arrayContaining(["execute_contract"]),
    }));
    expect(JSON.stringify(select.mock.calls)).not.toContain("privateKey");
  });

  it("falls back to deterministic grounded output when the hosted model fails", async () => {
    const onGatewayFallback = vi.fn();
    const answer = await answerAgentJobQuestion(
      job,
      "Summarize this incident",
      gatewayConfig,
      {
        provider: {
          id: "failing-provider",
          async select() {
            throw new Error("provider unavailable");
          },
        },
        onGatewayFallback,
      },
    );

    expect(answer.mode).toBe("DETERMINISTIC");
    expect(answer.fallbackUsed).toBe(true);
    expect(answer.response.explanation.kind).toBe("INCIDENT_REPORT");
    expect(onGatewayFallback).toHaveBeenCalledWith({ name: "Error" });
  });

  it("rejects an unanalysed job before creating model input", () => {
    const unanalysed = agentServiceJobSchema.parse({
      id: "job:empty",
      service: "safeexit-incident-response",
      status: "RECEIVED",
      history: [
        { sequence: 0, from: null, to: "RECEIVED", reason: "JOB_CREATED", at: now },
      ],
      revision: 0,
      createdAt: now,
      updatedAt: now,
    });

    expect(() => createAgentAiContext(unanalysed)).toThrow("Wallet analysis is required");
  });
});
