import { agentServiceJobSchema, type AgentServiceJob } from "./schemas";

export interface AgentServiceJobStore {
  get(jobId: string): Promise<AgentServiceJob | undefined>;
  getByRequestId(requestId: string): Promise<AgentServiceJob | undefined>;
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
