import type { AgentServiceJob } from "@safeexit/agent-service";
import type {
  Incident,
  RescuePlan,
  SimulationResult,
  WalletScan,
} from "@safeexit/shared";

import type { PrismaClient } from "./generated/prisma/client";
import {
  mapAgentJob,
  mapExecutionAttempt,
  mapIncident,
  mapRescuePlan,
  mapSimulation,
  mapWalletScan,
} from "./mappers";
import type { ExecutionAttempt } from "./schemas";

function updateData<T extends { id: string }>(data: T): Omit<T, "id"> {
  const update = { ...data } as Partial<T>;
  delete update.id;
  return update as Omit<T, "id">;
}

export class PrismaSafeExitRepository {
  constructor(private readonly client: PrismaClient) {}

  async getIncident(id: string): Promise<Incident | undefined> {
    const record = await this.client.incident.findUnique({ where: { id } });
    if (!record) {
      return undefined;
    }
    const domain = {
      id: record.id,
      chainId: Number(record.chainId),
      sourceAddress: record.sourceAddress,
      destinationAddress: record.destinationAddress,
      ...(record.assetManifest ? { assetManifest: record.assetManifest } : {}),
      status: record.status,
      ownershipAttestation: {
        accepted: true as const,
        statementVersion: record.ownershipStatementVersion,
        attestedAt: record.ownershipAttestedAt.toISOString(),
      },
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
    };
    return (await import("@safeexit/shared")).incidentSchema.parse(domain);
  }

  async saveIncident(value: unknown): Promise<Incident> {
    const domain = (await import("@safeexit/shared")).incidentSchema.parse(value);
    const data = mapIncident(domain);
    await this.client.incident.upsert({
      where: { id: data.id },
      create: data,
      update: updateData(data),
    });
    return domain;
  }

  async saveWalletScan(value: unknown): Promise<WalletScan> {
    const mapped = mapWalletScan(value);
    await this.client.$transaction(async (transaction) => {
      await transaction.walletScan.upsert({
        where: { id: mapped.scan.id },
        create: mapped.scan,
        update: updateData(mapped.scan),
      });
      await transaction.asset.deleteMany({ where: { scanId: mapped.scan.id } });
      await transaction.approval.deleteMany({ where: { scanId: mapped.scan.id } });
      if (mapped.assets.length > 0) {
        await transaction.asset.createMany({ data: mapped.assets });
      }
      if (mapped.approvals.length > 0) {
        await transaction.approval.createMany({ data: mapped.approvals });
      }
    });
    return mapped.domain;
  }

  async saveRescuePlan(value: unknown): Promise<RescuePlan> {
    const mapped = mapRescuePlan(value);
    await this.client.$transaction(async (transaction) => {
      await transaction.rescuePlan.upsert({
        where: { id: mapped.plan.id },
        create: mapped.plan,
        update: updateData(mapped.plan),
      });
      await transaction.rescueAction.deleteMany({
        where: {
          planId: mapped.plan.id,
          id: { notIn: mapped.actions.map((action) => action.id) },
        },
      });
      for (const action of mapped.actions) {
        await transaction.rescueAction.upsert({
          where: { id: action.id },
          create: action,
          update: updateData(action),
        });
      }
    });
    return mapped.domain;
  }

  async resolveRescuePlanVersion(incidentId: string, planId: string): Promise<number> {
    const existing = await this.client.rescuePlan.findUnique({
      where: { id: planId },
      select: { incidentId: true, version: true },
    });
    if (existing) {
      if (existing.incidentId !== incidentId) {
        throw new Error("Rescue plan ID belongs to a different incident");
      }
      return existing.version;
    }
    const latest = await this.client.rescuePlan.aggregate({
      where: { incidentId },
      _max: { version: true },
    });
    const next = (latest._max.version ?? 0) + 1;
    if (next > 2_147_483_647) {
      throw new Error("Rescue plan version exceeds the persistence limit");
    }
    return next;
  }

  async saveSimulation(value: unknown): Promise<SimulationResult> {
    const domain = (await import("@safeexit/shared")).simulationResultSchema.parse(value);
    const data = mapSimulation(domain);
    await this.client.simulation.upsert({
      where: { id: data.id },
      create: data,
      update: updateData(data),
    });
    return domain;
  }

  async saveExecutionAttempt(value: unknown): Promise<ExecutionAttempt> {
    const domain = (await import("./schemas")).executionAttemptSchema.parse(value);
    const data = mapExecutionAttempt(domain);
    await this.client.executionAttempt.upsert({
      where: { id: data.id },
      create: data,
      update: updateData(data),
    });
    return domain;
  }

  async saveAgentJob(value: unknown): Promise<AgentServiceJob> {
    const mapped = mapAgentJob(value);

    if (mapped.domain.incident) {
      await this.saveIncident(mapped.domain.incident);
    }
    if (mapped.domain.scan) {
      await this.saveWalletScan(mapped.domain.scan);
    }
    if (mapped.domain.plan) {
      await this.saveRescuePlan(mapped.domain.plan);
    }
    for (const simulation of mapped.domain.simulation?.results ?? []) {
      await this.saveSimulation(simulation);
    }

    await this.client.$transaction(async (transaction) => {
      await transaction.agentJob.upsert({
        where: { id: mapped.job.id },
        create: mapped.job,
        update: updateData(mapped.job),
      });
      await transaction.agentJobTransition.deleteMany({
        where: { jobId: mapped.job.id },
      });
      if (mapped.transitions.length > 0) {
        await transaction.agentJobTransition.createMany({
          data: mapped.transitions,
        });
      }
    });
    return mapped.domain;
  }
}
