import {
  agentServiceJobSchema,
  type AgentServiceJob,
  type AgentServiceStatus,
} from "./schemas";

export interface AgentServiceJobStore {
  get(jobId: string): Promise<AgentServiceJob | undefined>;
  getByRequestId(requestId: string): Promise<AgentServiceJob | undefined>;
  getByIncidentId(incidentId: string): Promise<AgentServiceJob | undefined>;
  listByStatuses(
    statuses: readonly AgentServiceStatus[],
    limit: number,
  ): Promise<AgentServiceJob[]>;
  save(job: AgentServiceJob): Promise<AgentServiceJob>;
}

export class InMemoryAgentServiceJobStore implements AgentServiceJobStore {
  private readonly jobs = new Map<string, AgentServiceJob>();

  async get(jobId: string): Promise<AgentServiceJob | undefined> {
    const job = this.jobs.get(jobId);
    return job ? agentServiceJobSchema.parse(job) : undefined;
  }

  async getByRequestId(requestId: string): Promise<AgentServiceJob | undefined> {
    const job = [...this.jobs.values()].find((candidate) => candidate.requestId === requestId);
    return job ? agentServiceJobSchema.parse(job) : undefined;
  }

  async getByIncidentId(incidentId: string): Promise<AgentServiceJob | undefined> {
    const job = [...this.jobs.values()]
      .filter((candidate) => candidate.incident?.id === incidentId)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
    return job ? agentServiceJobSchema.parse(job) : undefined;
  }

  async listByStatuses(
    statuses: readonly AgentServiceStatus[],
    limit: number,
  ): Promise<AgentServiceJob[]> {
    const allowed = new Set(statuses);
    return [...this.jobs.values()]
      .filter((job) => allowed.has(job.status))
      .sort((left, right) => left.updatedAt.localeCompare(right.updatedAt))
      .slice(0, limit)
      .map((job) => agentServiceJobSchema.parse(job));
  }

  async save(value: AgentServiceJob): Promise<AgentServiceJob> {
    const job = agentServiceJobSchema.parse(value);
    if (job.requestId) {
      const existing = await this.getByRequestId(job.requestId);
      if (existing && existing.id !== job.id) {
        throw new Error(`Agent-service request already exists: ${job.requestId}`);
      }
    }
    this.jobs.set(job.id, job);
    return agentServiceJobSchema.parse(job);
  }
}
