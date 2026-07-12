import { agentServiceJobSchema, type AgentServiceJob } from "./schemas";

export interface AgentServiceJobStore {
  get(jobId: string): Promise<AgentServiceJob | undefined>;
  save(job: AgentServiceJob): Promise<AgentServiceJob>;
}

export class InMemoryAgentServiceJobStore implements AgentServiceJobStore {
  private readonly jobs = new Map<string, AgentServiceJob>();

  async get(jobId: string): Promise<AgentServiceJob | undefined> {
    const job = this.jobs.get(jobId);
    return job ? agentServiceJobSchema.parse(job) : undefined;
  }

  async save(value: AgentServiceJob): Promise<AgentServiceJob> {
    const job = agentServiceJobSchema.parse(value);
    this.jobs.set(job.id, job);
    return agentServiceJobSchema.parse(job);
  }
}
