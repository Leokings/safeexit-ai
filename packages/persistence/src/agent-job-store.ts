import {
  agentServiceJobSchema,
  type AgentServiceJob,
  type AgentServiceJobStore,
} from "@safeexit/agent-service";

import type { PrismaClient } from "./generated/prisma/client";
import { PrismaSafeExitRepository } from "./repository";

export class PrismaAgentServiceJobStore implements AgentServiceJobStore {
  private readonly repository: PrismaSafeExitRepository;

  constructor(private readonly client: PrismaClient) {
    this.repository = new PrismaSafeExitRepository(client);
  }

  async get(jobId: string): Promise<AgentServiceJob | undefined> {
    const record = await this.client.agentJob.findUnique({
      where: { id: jobId },
      select: { state: true },
    });
    if (!record) {
      return undefined;
    }
    if (!record.state) {
      throw new Error("Agent job does not contain a recoverable lifecycle snapshot");
    }
    return agentServiceJobSchema.parse(record.state);
  }

  async save(value: AgentServiceJob): Promise<AgentServiceJob> {
    const job = agentServiceJobSchema.parse(value);
    await this.repository.saveAgentJob(job);
    return job;
  }
}
