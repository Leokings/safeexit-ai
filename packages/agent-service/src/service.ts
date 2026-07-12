import { z } from "zod";

import {
  incidentSchema,
  rescuePlanSchema,
  walletScanSchema,
  type Incident,
  type RescuePlan,
  type WalletScan,
} from "@safeexit/shared";

import { transitionJob, type TransitionPatch } from "./lifecycle";
import type {
  DashboardLocatorPort,
  IncidentAnalyzerPort,
  RescueMonitorPort,
  RescuePlanGeneratorPort,
  RescuePlanSimulatorPort,
} from "./ports";
import {
  agentServiceJobSchema,
  agentSimulationReportSchema,
  createIncidentInputSchema,
  rescueMonitorObservationSchema,
  type AgentServiceError,
  type AgentServiceJob,
  type CreateIncidentInput,
  type RescueMonitorObservation,
} from "./schemas";
import type { AgentServiceJobStore } from "./store";

export type AgentIncidentServiceOptions = {
  store: AgentServiceJobStore;
  analyzer: IncidentAnalyzerPort;
  planner: RescuePlanGeneratorPort;
  simulator: RescuePlanSimulatorPort;
  dashboard: DashboardLocatorPort;
  monitor: RescueMonitorPort;
  clock?: () => Date;
  idFactory?: () => string;
};

function messageFor(error: unknown): string {
  return (error instanceof Error ? error.message : "Agent service operation failed").slice(0, 1_000);
}

function validateScanScope(incident: Incident, scan: WalletScan): void {
  if (
    scan.incidentId !== incident.id ||
    scan.chainId !== incident.chainId ||
    scan.address.toLowerCase() !== incident.sourceAddress.toLowerCase()
  ) {
    throw new Error("Analyzer returned a scan outside the incident scope");
  }
}

function validatePlanScope(incident: Incident, scan: WalletScan, plan: RescuePlan): void {
  if (
    plan.incidentId !== incident.id ||
    plan.chainId !== incident.chainId ||
    plan.sourceAddress.toLowerCase() !== scan.address.toLowerCase() ||
    plan.destinationAddress.toLowerCase() !== incident.destinationAddress.toLowerCase() ||
    plan.observedAtBlock !== scan.observedAtBlock
  ) {
    throw new Error("Planner returned a plan outside the analyzed incident scope");
  }
}

export class AgentIncidentService {
  private readonly store: AgentServiceJobStore;
  private readonly analyzer: IncidentAnalyzerPort;
  private readonly planner: RescuePlanGeneratorPort;
  private readonly simulator: RescuePlanSimulatorPort;
  private readonly dashboard: DashboardLocatorPort;
  private readonly monitor: RescueMonitorPort;
  private readonly clock: () => Date;
  private readonly idFactory: () => string;

  constructor(options: AgentIncidentServiceOptions) {
    this.store = options.store;
    this.analyzer = options.analyzer;
    this.planner = options.planner;
    this.simulator = options.simulator;
    this.dashboard = options.dashboard;
    this.monitor = options.monitor;
    this.clock = options.clock ?? (() => new Date());
    this.idFactory = options.idFactory ?? (() => `job:${crypto.randomUUID()}`);
  }

  async createIncident(value: CreateIncidentInput): Promise<AgentServiceJob> {
    const input = createIncidentInputSchema.parse(value);
    const at = this.now();
    const id = this.idFactory();
    let job = agentServiceJobSchema.parse({
      id,
      ...(input.requestId ? { requestId: input.requestId } : {}),
      service: "safeexit-incident-response",
      status: "RECEIVED",
      ...(input.incident ? { incident: input.incident } : {}),
      history: [
        {
          sequence: 0,
          from: null,
          to: "RECEIVED",
          reason: "JOB_CREATED",
          at,
        },
      ],
      revision: 0,
      createdAt: at,
      updatedAt: at,
    });

    if (!job.incident) {
      job = transitionJob(job, "WAITING_FOR_SOURCE", "SOURCE_REQUIRED", at);
    }
    return this.store.save(job);
  }

  async analyseIncident(jobId: string, incident?: Incident): Promise<AgentServiceJob> {
    let job = await this.requireJob(jobId);
    if (job.status !== "RECEIVED" && job.status !== "WAITING_FOR_SOURCE") {
      throw new Error(`Cannot analyse an incident while job is ${job.status}`);
    }

    const suppliedIncident = incident ? incidentSchema.parse(incident) : undefined;
    if (suppliedIncident && job.incident && job.incident.id !== suppliedIncident.id) {
        throw new Error("Cannot replace an existing incident with a different incident ID");
    }
    const scopedIncident = suppliedIncident ?? job.incident;
    if (!scopedIncident) {
      throw new Error("Incident source and destination are required before analysis");
    }

    job = transitionJob(job, "ANALYSING", "ANALYSIS_STARTED", this.now(), {
      incident: scopedIncident,
    });
    job = await this.store.save(job);
    try {
      const scan = walletScanSchema.parse(await this.analyzer.analyse(scopedIncident));
      validateScanScope(scopedIncident, scan);
      return this.updateJob(job, { scan });
    } catch (error) {
      return this.failJob(job, "ANALYSIS_FAILED", "ANALYSIS_FAILED", error);
    }
  }

  async generatePlan(jobId: string): Promise<AgentServiceJob> {
    const job = await this.requireJob(jobId);
    if (job.status !== "ANALYSING" || !job.incident || !job.scan) {
      throw new Error("A scoped incident scan is required before plan generation");
    }

    try {
      const plan = rescuePlanSchema.parse(await this.planner.generate(job.incident, job.scan));
      validatePlanScope(job.incident, job.scan, plan);
      return this.store.save(
        transitionJob(job, "PLAN_READY", "PLAN_GENERATED", this.now(), { plan }),
      );
    } catch (error) {
      return this.failJob(job, "PLAN_FAILED", "PLAN_FAILED", error);
    }
  }

  async simulatePlan(jobId: string): Promise<AgentServiceJob> {
    const job = await this.requireJob(jobId);
    if (job.status !== "PLAN_READY" || !job.plan) {
      throw new Error("A ready rescue plan is required before simulation");
    }

    try {
      const simulation = agentSimulationReportSchema.parse(
        await this.simulator.simulate(job.plan),
      );
      this.validateSimulation(job.plan, simulation);
      if (simulation.status === "FAILED") {
        return this.failJob(
          job,
          "SIMULATION_FAILED",
          "SIMULATION_FAILED",
          new Error("No rescue action simulated successfully"),
          { simulation },
        );
      }
      return this.store.save(
        transitionJob(job, "WAITING_FOR_USER", "SIMULATION_READY", this.now(), {
          simulation,
        }),
      );
    } catch (error) {
      return this.failJob(job, "SIMULATION_FAILED", "SIMULATION_FAILED", error);
    }
  }

  async getDashboardUrl(jobId: string): Promise<string> {
    const job = await this.requireJob(jobId);
    const dashboardUrl = z.string().url().parse(this.dashboard.getDashboardUrl(job));
    await this.updateJob(job, { dashboardUrl });
    return dashboardUrl;
  }

  async monitorRescue(jobId: string): Promise<AgentServiceJob> {
    let job = await this.requireJob(jobId);
    if (["COMPLETED", "PARTIAL", "FAILED"].includes(job.status)) {
      return job;
    }
    if (!["WAITING_FOR_USER", "SIGNING", "EXECUTING"].includes(job.status) || !job.plan) {
      throw new Error(`Rescue monitoring is not available while job is ${job.status}`);
    }

    try {
      const observation = rescueMonitorObservationSchema.parse(await this.monitor.observe(job));
      this.validateObservation(job.plan, observation);
      job = await this.advanceToObservation(job, observation);
      return job;
    } catch (error) {
      return this.failJob(job, "MONITOR_FAILED", "RESCUE_FAILED", error);
    }
  }

  async getJob(jobId: string): Promise<AgentServiceJob> {
    return this.requireJob(jobId);
  }

  private async advanceToObservation(
    job: AgentServiceJob,
    observation: RescueMonitorObservation,
  ): Promise<AgentServiceJob> {
    let next = job;

    if (observation.phase === "WAITING_FOR_USER") {
      if (next.status !== "WAITING_FOR_USER") {
        throw new Error("Monitor observation would regress the rescue lifecycle");
      }
      return this.updateJob(next, { monitor: observation });
    }

    if (next.status === "WAITING_FOR_USER") {
      next = transitionJob(next, "SIGNING", "SIGNING_OBSERVED", this.now());
    }
    if (observation.phase === "SIGNING") {
      if (next.status !== "SIGNING") {
        throw new Error("Monitor observation would regress the rescue lifecycle");
      }
      return this.updateJob(next, { monitor: observation });
    }

    if (next.status === "SIGNING") {
      next = transitionJob(next, "EXECUTING", "EXECUTION_OBSERVED", this.now());
    }
    if (observation.phase === "EXECUTING") {
      if (next.status !== "EXECUTING") {
        throw new Error("Monitor observation would regress the rescue lifecycle");
      }
      return this.updateJob(next, { monitor: observation });
    }

    if (next.status !== "EXECUTING") {
      throw new Error("Terminal rescue observation requires execution state");
    }

    const terminal = {
      COMPLETED: ["COMPLETED", "RESCUE_COMPLETED"],
      PARTIAL: ["PARTIAL", "RESCUE_PARTIAL"],
      FAILED: ["FAILED", "RESCUE_FAILED"],
    } as const;
    const target = terminal[observation.phase];
    return this.store.save(
      transitionJob(next, target[0], target[1], this.now(), { monitor: observation }),
    );
  }

  private validateSimulation(
    plan: RescuePlan,
    simulation: ReturnType<typeof agentSimulationReportSchema.parse>,
  ): void {
    const actionIds = new Set(plan.actions.map((action) => action.id));
    const executableIds = new Set(simulation.executableActionIds);
    const excludedIds = new Set(simulation.excludedActionIds);
    for (const actionId of [...executableIds, ...excludedIds]) {
      if (!actionIds.has(actionId)) {
        throw new Error("Simulation report references an action outside the rescue plan");
      }
      if (executableIds.has(actionId) && excludedIds.has(actionId)) {
        throw new Error("Simulation action cannot be both executable and excluded");
      }
    }
    for (const result of simulation.results) {
      if (
        result.planId !== plan.id ||
        result.planHash.toLowerCase() !== plan.integrityHash.toLowerCase() ||
        !actionIds.has(result.actionId)
      ) {
        throw new Error("Simulation result does not match the rescue plan");
      }
    }
  }

  private validateObservation(plan: RescuePlan, observation: RescueMonitorObservation): void {
    const actionIds = new Set(plan.actions.map((action) => action.id));
    const completed = new Set(observation.completedActionIds);
    const failed = new Set(observation.failedActionIds);
    for (const actionId of [...completed, ...failed]) {
      if (!actionIds.has(actionId)) {
        throw new Error("Monitor observation references an action outside the rescue plan");
      }
      if (completed.has(actionId) && failed.has(actionId)) {
        throw new Error("Monitor action cannot be both completed and failed");
      }
    }
    if (
      (observation.phase === "COMPLETED" || observation.phase === "PARTIAL") &&
      observation.transactionHashes.length === 0
    ) {
      throw new Error("Completed or partial rescue observation requires a transaction hash");
    }
  }

  private async failJob(
    job: AgentServiceJob,
    code: AgentServiceError["code"],
    reason: "ANALYSIS_FAILED" | "PLAN_FAILED" | "SIMULATION_FAILED" | "RESCUE_FAILED",
    error: unknown,
    patch: TransitionPatch = {},
  ): Promise<AgentServiceJob> {
    if (job.status === "FAILED") {
      return job;
    }
    return this.store.save(
      transitionJob(job, "FAILED", reason, this.now(), {
        ...patch,
        error: { code, message: messageFor(error) },
      }),
    );
  }

  private async updateJob(
    job: AgentServiceJob,
    patch: Partial<Pick<AgentServiceJob, "incident" | "scan" | "monitor" | "dashboardUrl">>,
  ): Promise<AgentServiceJob> {
    const at = this.now();
    return this.store.save(
      agentServiceJobSchema.parse({
        ...job,
        ...patch,
        revision: job.revision + 1,
        updatedAt: at,
      }),
    );
  }

  private async requireJob(jobId: string): Promise<AgentServiceJob> {
    const job = await this.store.get(jobId);
    if (!job) {
      throw new Error(`Agent-service job not found: ${jobId}`);
    }
    return job;
  }

  private now(): string {
    return this.clock().toISOString();
  }
}
