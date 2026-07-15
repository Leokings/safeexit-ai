import {
  agentServiceJobSchema,
  type AgentServiceJob,
  type AgentServiceJobStore,
  type AgentServiceStatus,
} from "@safeexit/agent-service";

import { AgentJobStatus, type PrismaClient } from "./generated/prisma/client";
import { PrismaSafeExitRepository } from "./repository";

function parsePersistedJob(record: { state: unknown; revision: number }): AgentServiceJob {
  if (!record.state) {
    throw new Error("Agent job does not contain a recoverable lifecycle snapshot");
  }
  const job = agentServiceJobSchema.parse(record.state);
  if (job.revision !== record.revision) {
    throw new Error("Agent job snapshot revision does not match its persistence record");
  }
  return job;
}

export class PrismaAgentServiceJobStore implements AgentServiceJobStore {
  private readonly repository: PrismaSafeExitRepository;

  constructor(private readonly client: PrismaClient) {
    this.repository = new PrismaSafeExitRepository(client);
  }

  async get(jobId: string): Promise<AgentServiceJob | undefined> {
    const record = await this.client.agentJob.findUnique({
      where: { id: jobId },
      select: { state: true, revision: true },
    });
    if (!record) {
      return undefined;
    }
    return parsePersistedJob(record);
  }

  async getByRequestId(requestId: string): Promise<AgentServiceJob | undefined> {
    const record = await this.client.agentJob.findUnique({
      where: { requestId },
      select: { state: true, revision: true },
    });
    if (!record) {
      return undefined;
    }
    return parsePersistedJob(record);
  }

  async getByIncidentId(incidentId: string): Promise<AgentServiceJob | undefined> {
    const record = await this.client.agentJob.findFirst({
      where: { incidentId },
      orderBy: { updatedAt: "desc" },
      select: { state: true, revision: true },
    });
    if (!record) {
      return undefined;
    }
    return parsePersistedJob(record);
  }

  async listByStatuses(
    statuses: readonly AgentServiceStatus[],
    limit: number,
  ): Promise<AgentServiceJob[]> {
    const records = await this.client.agentJob.findMany({
      where: {
        status: {
          in: statuses.map((status) => AgentJobStatus[status]),
        },
      },
      orderBy: { updatedAt: "asc" },
      take: Math.max(1, Math.min(limit, 100)),
      select: { state: true, revision: true },
    });
    return records.map((record) => {
      return parsePersistedJob(record);
    });
  }

  async save(value: AgentServiceJob, expectedRevision?: number): Promise<AgentServiceJob> {
    const job = agentServiceJobSchema.parse(value);
    await this.repository.saveAgentJob(job, expectedRevision);
    return job;
  }
}
