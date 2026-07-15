import {
  AgentJobRevisionConflictError,
  type AgentServiceJob,
} from "@safeexit/agent-service";
import type {
  Incident,
  RescuePlan,
  SimulationResult,
  WalletScan,
} from "@safeexit/shared";

import type { Prisma, PrismaClient } from "./generated/prisma/client";
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

type TransactionClient = Prisma.TransactionClient;

async function persistIncident(
  client: TransactionClient,
  data: ReturnType<typeof mapIncident>,
): Promise<void> {
  await client.incident.upsert({
    where: { id: data.id },
    create: data,
    update: updateData(data),
  });
}

async function persistWalletScan(
  client: TransactionClient,
  mapped: ReturnType<typeof mapWalletScan>,
): Promise<void> {
  await client.walletScan.upsert({
    where: { id: mapped.scan.id },
    create: mapped.scan,
    update: updateData(mapped.scan),
  });
  await client.asset.deleteMany({ where: { scanId: mapped.scan.id } });
  await client.approval.deleteMany({ where: { scanId: mapped.scan.id } });
  if (mapped.assets.length > 0) {
    await client.asset.createMany({ data: mapped.assets });
  }
  if (mapped.approvals.length > 0) {
    await client.approval.createMany({ data: mapped.approvals });
  }
}

async function persistRescuePlan(
  client: TransactionClient,
  mapped: ReturnType<typeof mapRescuePlan>,
): Promise<void> {
  await client.rescuePlan.upsert({
    where: { id: mapped.plan.id },
    create: mapped.plan,
    update: updateData(mapped.plan),
  });
  await client.rescueAction.deleteMany({
    where: {
      planId: mapped.plan.id,
      id: { notIn: mapped.actions.map((action) => action.id) },
    },
  });
  for (const action of mapped.actions) {
    await client.rescueAction.upsert({
      where: { id: action.id },
      create: action,
      update: updateData(action),
    });
  }
}

async function persistSimulation(
  client: TransactionClient,
  data: ReturnType<typeof mapSimulation>,
): Promise<void> {
  await client.simulation.upsert({
    where: { id: data.id },
    create: data,
    update: updateData(data),
  });
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
    await persistIncident(this.client, data);
    return domain;
  }

  async saveWalletScan(value: unknown): Promise<WalletScan> {
    const mapped = mapWalletScan(value);
    await this.client.$transaction(async (transaction) => {
      await persistWalletScan(transaction, mapped);
    });
    return mapped.domain;
  }

  async saveRescuePlan(value: unknown): Promise<RescuePlan> {
    const mapped = mapRescuePlan(value);
    await this.client.$transaction(async (transaction) => {
      await persistRescuePlan(transaction, mapped);
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
    await persistSimulation(this.client, data);
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

  async saveAgentJob(value: unknown, expectedRevision?: number): Promise<AgentServiceJob> {
    const mapped = mapAgentJob(value);
    const incident = mapped.domain.incident
      ? mapIncident(mapped.domain.incident)
      : undefined;
    const scan = mapped.domain.scan
      ? mapWalletScan(mapped.domain.scan)
      : undefined;
    const plan = mapped.domain.plan
      ? mapRescuePlan(mapped.domain.plan)
      : undefined;
    const simulations = (mapped.domain.simulation?.results ?? []).map(mapSimulation);

    await this.client.$transaction(async (transaction) => {
      if (incident) await persistIncident(transaction, incident);
      if (scan) await persistWalletScan(transaction, scan);
      if (plan) await persistRescuePlan(transaction, plan);
      for (const simulation of simulations) {
        await persistSimulation(transaction, simulation);
      }
      const existing = await transaction.agentJob.findUnique({
        where: { id: mapped.job.id },
        select: { revision: true },
      });
      if (!existing) {
        await transaction.agentJob.create({ data: mapped.job });
      } else {
        const expected = expectedRevision ?? mapped.job.revision - 1;
        if (expected < 0 || mapped.job.revision <= expected) {
          throw new AgentJobRevisionConflictError(mapped.job.id);
        }
        const updated = await transaction.agentJob.updateMany({
          where: { id: mapped.job.id, revision: expected },
          data: updateData(mapped.job),
        });
        if (updated.count !== 1) {
          throw new AgentJobRevisionConflictError(mapped.job.id);
        }
      }
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
