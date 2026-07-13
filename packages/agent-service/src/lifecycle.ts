import { agentServiceJobSchema } from "./schemas";
import type {
  AgentServiceJob,
  AgentServiceStatus,
  TransitionReason,
} from "./schemas";

export const ALLOWED_AGENT_SERVICE_TRANSITIONS: Readonly<
  Record<AgentServiceStatus, readonly AgentServiceStatus[]>
> = {
  RECEIVED: ["WAITING_FOR_SOURCE", "ANALYSING", "FAILED"],
  WAITING_FOR_SOURCE: ["ANALYSING", "FAILED"],
  ANALYSING: ["PLAN_READY", "FAILED"],
  PLAN_READY: ["WAITING_FOR_USER", "FAILED"],
  WAITING_FOR_USER: ["SIGNING", "FAILED"],
  SIGNING: ["EXECUTING", "FAILED"],
  EXECUTING: ["COMPLETED", "PARTIAL", "FAILED"],
  COMPLETED: [],
  PARTIAL: [],
  FAILED: [],
};

export type TransitionPatch = Partial<
  Pick<
    AgentServiceJob,
    "incident" | "scan" | "plan" | "simulation" | "signingPackage" | "monitor" | "dashboardUrl" | "error"
  >
>;

export function canTransition(
  from: AgentServiceStatus,
  to: AgentServiceStatus,
): boolean {
  return ALLOWED_AGENT_SERVICE_TRANSITIONS[from].includes(to);
}

export function transitionJob(
  value: AgentServiceJob,
  to: AgentServiceStatus,
  reason: TransitionReason,
  at: string,
  patch: TransitionPatch = {},
): AgentServiceJob {
  const job = agentServiceJobSchema.parse(value);
  if (!canTransition(job.status, to)) {
    throw new Error(`Invalid agent-service transition: ${job.status} -> ${to}`);
  }

  return agentServiceJobSchema.parse({
    ...job,
    ...patch,
    status: to,
    history: [
      ...job.history,
      {
        sequence: job.history.length,
        from: job.status,
        to,
        reason,
        at,
      },
    ],
    revision: job.revision + 1,
    updatedAt: at,
  });
}
