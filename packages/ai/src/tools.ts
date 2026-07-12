import { aiIncidentContextSchema, aiToolCallSchema, aiToolResultSchema } from "./schemas";
import type { AiIncidentContext, AiToolCall, AiToolResult, AiToolName } from "./schemas";

export const SAFEEXIT_AI_TOOL_NAMES = [
  "scan_wallet",
  "scan_approvals",
  "get_rescue_plan",
  "simulate_plan",
  "explain_action",
  "get_rescue_status",
] as const satisfies readonly AiToolName[];

export interface AiIncidentToolGateway {
  readonly toolNames: readonly AiToolName[];
  invoke(call: AiToolCall): AiToolResult;
}

export class StructuredIncidentToolGateway implements AiIncidentToolGateway {
  readonly toolNames = SAFEEXIT_AI_TOOL_NAMES;
  private readonly context: AiIncidentContext;

  constructor(context: AiIncidentContext) {
    this.context = aiIncidentContextSchema.parse(context);
  }

  invoke(value: AiToolCall): AiToolResult {
    const call = aiToolCallSchema.parse(value);
    switch (call.name) {
      case "scan_wallet": {
        this.assertIncident(call.input.incidentId);
        return aiToolResultSchema.parse({ name: call.name, output: this.context.scan });
      }
      case "scan_approvals": {
        this.assertIncident(call.input.incidentId);
        return aiToolResultSchema.parse({
          name: call.name,
          output: {
            scanId: this.context.scan.id,
            approvals: this.context.scan.approvals,
          },
        });
      }
      case "get_rescue_plan": {
        this.assertIncident(call.input.incidentId);
        if (!this.context.plan) {
          throw new Error("No rescue plan is available for this incident snapshot");
        }
        return aiToolResultSchema.parse({ name: call.name, output: this.context.plan });
      }
      case "simulate_plan": {
        if (!this.context.plan || this.context.plan.id !== call.input.planId) {
          throw new Error("Requested plan is not available in this incident snapshot");
        }
        return aiToolResultSchema.parse({
          name: call.name,
          output: {
            planId: this.context.plan.id,
            results: this.context.simulations,
            excludedActionIds: this.context.simulations
              .filter((result) => result.status !== "SUCCEEDED")
              .map((result) => result.actionId),
          },
        });
      }
      case "explain_action": {
        if (!this.context.plan || this.context.plan.id !== call.input.planId) {
          throw new Error("Requested plan is not available in this incident snapshot");
        }
        const action = this.context.plan.actions.find(
          (candidate) => candidate.id === call.input.actionId,
        );
        if (!action) {
          throw new Error("Requested action is not available in this rescue plan");
        }
        return aiToolResultSchema.parse({ name: call.name, output: action });
      }
      case "get_rescue_status": {
        this.assertIncident(call.input.incidentId);
        return aiToolResultSchema.parse({ name: call.name, output: this.context.status });
      }
    }
  }

  private assertIncident(requestedIncidentId: string): void {
    if (requestedIncidentId !== this.context.incident.id) {
      throw new Error("Requested incident is outside the grounded AI context");
    }
  }
}
