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
  BuyerExecutionVerifierPort,
  DashboardLocatorPort,
  IncidentAnalyzerPort,
  RescueMonitorPort,
  RescuePlanGeneratorPort,
  RescuePlanSimulatorPort,
  SigningPackageBuilderPort,
} from "./ports";
import {
  BuyerReceiptPendingError,
  BuyerReceiptRejectedError,
  BuyerReceiptRevertedError,
  buyerExecutionReportSchema,
  buyerReceiptRegistrationSchema,
  type BuyerExecutionReport,
  type BuyerReceiptRegistration,
} from "./buyer-report";
import {
  agentServiceJobSchema,
  agentSimulationReportSchema,
  createIncidentInputSchema,
  rescueMonitorObservationSchema,
  type AgentServiceError,
  type AgentServiceJob,
  type BuyerReceiptSubmissionStatus,
  type CreateIncidentInput,
  type RescueMonitorObservation,
} from "./schemas";
import {
  signingPackageListSchema,
  type SigningPackage,
} from "./signing-package";
import {
  AgentJobRevisionConflictError,
  type AgentServiceJobStore,
} from "./store";

export type AgentIncidentServiceOptions = {
  store: AgentServiceJobStore;
  analyzer: IncidentAnalyzerPort;
  planner: RescuePlanGeneratorPort;
  simulator: RescuePlanSimulatorPort;
  dashboard: DashboardLocatorPort;
  signingPackages: SigningPackageBuilderPort;
  executionVerifier: BuyerExecutionVerifierPort;
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

function validateIdempotentIncidentScope(
  existing: AgentServiceJob,
  requested: Incident | undefined,
): void {
  if (!existing.incident && !requested) return;
  if (
    !existing.incident ||
    !requested ||
    existing.incident.chainId !== requested.chainId ||
    existing.incident.sourceAddress.toLowerCase() !== requested.sourceAddress.toLowerCase() ||
    existing.incident.destinationAddress.toLowerCase() !== requested.destinationAddress.toLowerCase() ||
    existing.incident.ownershipAttestation.accepted !== requested.ownershipAttestation.accepted ||
    existing.incident.ownershipAttestation.statementVersion !==
      requested.ownershipAttestation.statementVersion
  ) {
    throw new Error("An existing request ID cannot be reused for a different incident scope");
  }
}

export class AgentIncidentService {
  private readonly store: AgentServiceJobStore;
  private readonly analyzer: IncidentAnalyzerPort;
  private readonly planner: RescuePlanGeneratorPort;
  private readonly simulator: RescuePlanSimulatorPort;
  private readonly dashboard: DashboardLocatorPort;
  private readonly signingPackages: SigningPackageBuilderPort;
  private readonly executionVerifier: BuyerExecutionVerifierPort;
  private readonly monitor: RescueMonitorPort;
  private readonly clock: () => Date;
  private readonly idFactory: () => string;

  constructor(options: AgentIncidentServiceOptions) {
    this.store = options.store;
    this.analyzer = options.analyzer;
    this.planner = options.planner;
    this.simulator = options.simulator;
    this.dashboard = options.dashboard;
    this.signingPackages = options.signingPackages;
    this.executionVerifier = options.executionVerifier;
    this.monitor = options.monitor;
    this.clock = options.clock ?? (() => new Date());
    this.idFactory = options.idFactory ?? (() => `job:${crypto.randomUUID()}`);
  }

  async createIncident(value: CreateIncidentInput): Promise<AgentServiceJob> {
    const input = createIncidentInputSchema.parse(value);
    if (input.requestId) {
      const existing = await this.store.getByRequestId(input.requestId);
      if (existing) {
        validateIdempotentIncidentScope(existing, input.incident);
        return existing;
      }
    }
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
    try {
      return await this.store.save(job);
    } catch (error) {
      if (input.requestId) {
        const existing = await this.store.getByRequestId(input.requestId);
        if (existing) {
          validateIdempotentIncidentScope(existing, input.incident);
          return existing;
        }
      }
      throw error;
    }
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

  async getSigningPackage(jobId: string): Promise<SigningPackage> {
    const signingPackages = await this.getSigningPackages(jobId);
    const signingPackage = signingPackages[0];
    if (!signingPackage) {
      throw new Error("Signing package is unavailable: no supported package was issued");
    }
    return signingPackage;
  }

  async getSigningPackages(jobId: string): Promise<SigningPackage[]> {
    let job = await this.requireJob(jobId);
    const persisted = job.signingPackages ?? (job.signingPackage ? [job.signingPackage] : []);
    if (
      persisted.length > 0 &&
      persisted.every((signingPackage) => Date.parse(signingPackage.expiresAt) > this.clock().getTime())
    ) {
      return signingPackageListSchema.parse(persisted);
    }
    if (
      job.status !== "WAITING_FOR_USER" ||
      !job.incident ||
      !job.plan ||
      !job.simulation
    ) {
      throw new Error("A successfully simulated rescue plan is required before signing-package generation");
    }
    const committedPlan = job.plan;
    try {
      const minimumSigningWindow = this.clock().getTime() + 30_000;
      const executableActionIds = new Set(job.simulation.executableActionIds);
      const executableResults = job.simulation.results
        .filter((result) => executableActionIds.has(result.actionId));
      const simulationIsFresh =
        executableResults.length === executableActionIds.size &&
        executableResults.every((result) => Date.parse(result.expiresAt) > minimumSigningWindow);
      if (persisted.length > 0 || !simulationIsFresh) {
        const simulation = agentSimulationReportSchema.parse(
          await this.simulator.simulate(committedPlan),
        );
        this.validateSimulation(committedPlan, simulation);
        if (simulation.status === "FAILED") {
          throw new Error("The committed rescue plan no longer simulates successfully");
        }
        job = await this.updateJob(job, { simulation });
      }
      const signingPackages = signingPackageListSchema.parse(
        this.signingPackages.buildAll
          ? await this.signingPackages.buildAll(job)
          : [await this.signingPackages.build(job)],
      );
      const actionOrder = new Map(committedPlan.actions.map((action, index) => [action.id, index]));
      let previousIndex = -1;
      for (const signingPackage of signingPackages) {
        this.validateSigningPackage(job, signingPackage);
        const currentIndex = actionOrder.get(signingPackage.actionId);
        if (currentIndex === undefined || currentIndex <= previousIndex) {
          throw new Error("Signing packages must follow deterministic rescue-plan order");
        }
        previousIndex = currentIndex;
      }
      await this.updateJob(job, {
        signingPackage: signingPackages[0],
        signingPackages,
      });
      return signingPackages;
    } catch (error) {
      throw new Error(`Signing package is unavailable: ${messageFor(error)}`);
    }
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

  async recordBuyerExecutionReport(
    jobId: string,
    reportValue: BuyerExecutionReport,
  ): Promise<AgentServiceJob> {
    const report = buyerExecutionReportSchema.parse(reportValue);
    return this.retryJobMutation(jobId, (job) =>
      this.recordBuyerExecutionReportForJob(job, report));
  }

  private async recordBuyerExecutionReportForJob(
    job: AgentServiceJob,
    report: BuyerExecutionReport,
  ): Promise<AgentServiceJob> {
    if (job.status === "COMPLETED" || job.status === "PARTIAL") {
      const signingPackage = this.validateBuyerReportScope(job, report);
      const observedHashes = new Set(
        job.monitor?.transactionHashes.map((hash) => hash.toLowerCase()) ?? [],
      );
      const exactVerifiedRetry =
        job.monitor?.completedActionIds.includes(signingPackage.actionId) === true &&
        report.transactionHashes.every((hash) => observedHashes.has(hash.toLowerCase()));
      if (!exactVerifiedRetry) {
        throw new Error("Completed buyer report retry does not match verified receipts");
      }
      const receiptPatch = this.confirmedReceiptPatch(
        job,
        signingPackage.packageId,
        report.transactionHashes,
      );
      return receiptPatch.receiptSubmissions
        ? this.updateJob(job, receiptPatch)
        : job;
    }
    if (
      !["WAITING_FOR_USER", "SIGNING", "EXECUTING"].includes(job.status) ||
      (job.signingPackages?.length ?? (job.signingPackage ? 1 : 0)) === 0 ||
      !job.plan
    ) {
      throw new Error(`Buyer execution reporting is not available while job is ${job.status}`);
    }
    const signingPackage = this.validateBuyerReportScope(job, report);
    const observation = rescueMonitorObservationSchema.parse(
      await this.executionVerifier.verify(job, report),
    );
    this.validateObservation(job.plan, observation);
    if (observation.phase !== "COMPLETED") {
      throw new Error("A verified buyer execution report must produce a completed observation");
    }
    const issuedPackages = job.signingPackages ?? (job.signingPackage ? [job.signingPackage] : []);
    const completedActionIds = [
      ...new Set([
        ...(job.monitor?.completedActionIds ?? []),
        ...observation.completedActionIds,
      ]),
    ];
    const failedActionIds = [
      ...new Set([
        ...(job.monitor?.failedActionIds ?? []),
        ...observation.failedActionIds,
      ]),
    ].filter((actionId) => !completedActionIds.includes(actionId));
    const transactionHashes = [
      ...new Map(
        [...(job.monitor?.transactionHashes ?? []), ...observation.transactionHashes].map(
          (hash) => [hash.toLowerCase(), hash] as const,
        ),
      ).values(),
    ];
    const everyIssuedPackageCompleted = issuedPackages.every((signingPackage) =>
      completedActionIds.includes(signingPackage.actionId),
    );
    const issuedActionIds = new Set(issuedPackages.map((signingPackage) => signingPackage.actionId));
    const uncoveredExecutableAction = job.simulation?.executableActionIds.some(
      (actionId) => !issuedActionIds.has(actionId),
    ) ?? false;
    const hasExcludedActions = (job.simulation?.excludedActionIds.length ?? 0) > 0;
    const phase = everyIssuedPackageCompleted
      ? uncoveredExecutableAction || hasExcludedActions
        ? "PARTIAL" as const
        : "COMPLETED" as const
      : "EXECUTING" as const;
    return this.advanceToObservation(job, rescueMonitorObservationSchema.parse({
      phase,
      completedActionIds,
      failedActionIds,
      transactionHashes,
      observedAt: observation.observedAt,
      detail: everyIssuedPackageCompleted
        ? phase === "COMPLETED"
          ? "All issued SAFEEXIT signing packages were verified onchain"
          : "All issued SAFEEXIT signing packages were verified; unsupported or uncovered actions remain"
        : "A SAFEEXIT signing package was verified; additional issued packages remain",
    }), this.confirmedReceiptPatch(job, signingPackage.packageId, report.transactionHashes));
  }

  async recordBuyerReceiptSubmission(
    jobId: string,
    value: BuyerReceiptRegistration,
  ): Promise<AgentServiceJob> {
    const input = buyerReceiptRegistrationSchema.parse(value);
    return this.retryJobMutation(jobId, (job) =>
      this.recordBuyerReceiptSubmissionForJob(job, input));
  }

  private async recordBuyerReceiptSubmissionForJob(
    job: AgentServiceJob,
    input: BuyerReceiptRegistration,
  ): Promise<AgentServiceJob> {
    const signingPackage = (job.signingPackages ?? (job.signingPackage ? [job.signingPackage] : []))
      .find((candidate) => candidate.packageId === input.packageId);
    if (!signingPackage) {
      throw new Error("Receipt submission does not reference an issued signing package");
    }
    const existing = job.receiptSubmissions?.find(
      (submission) =>
        submission.transactionHash.toLowerCase() === input.transactionHash.toLowerCase(),
    );
    if (existing) {
      if (existing.packageId !== input.packageId) {
        throw new Error("A transaction hash cannot be registered for multiple signing packages");
      }
      return job;
    }
    if (!["WAITING_FOR_USER", "SIGNING", "EXECUTING"].includes(job.status)) {
      throw new Error(`Receipt submission is not available while job is ${job.status}`);
    }
    const at = this.now();
    return this.updateJob(job, {
      receiptSubmissions: [
        ...(job.receiptSubmissions ?? []),
        {
          packageId: input.packageId,
          transactionHash: input.transactionHash,
          status: "PENDING",
          submittedAt: at,
          updatedAt: at,
        },
      ],
    });
  }

  async reconcileBuyerReceiptSubmission(
    jobId: string,
    value: BuyerReceiptRegistration,
  ): Promise<{
    status: BuyerReceiptSubmissionStatus;
    job: AgentServiceJob;
  }> {
    const input = buyerReceiptRegistrationSchema.parse(value);
    let job = await this.requireJob(jobId);
    const submission = job.receiptSubmissions?.find(
      (candidate) =>
        candidate.packageId === input.packageId &&
        candidate.transactionHash.toLowerCase() === input.transactionHash.toLowerCase(),
    );
    if (!submission) {
      throw new Error("Receipt submission must be registered before reconciliation");
    }
    if (submission.status !== "PENDING") {
      return { status: submission.status, job };
    }

    const report = this.reportForReceiptSubmission(job, input);
    try {
      job = await this.recordBuyerExecutionReport(job.id, report);
      return { status: "CONFIRMED", job };
    } catch (error) {
      if (error instanceof BuyerReceiptPendingError) {
        return { status: "PENDING", job };
      }
      if (error instanceof BuyerReceiptRevertedError) {
        job = await this.setReceiptSubmissionStatus(job, input, "REVERTED");
        return { status: "REVERTED", job };
      }
      if (error instanceof BuyerReceiptRejectedError) {
        job = await this.setReceiptSubmissionStatus(job, input, "REJECTED");
        return { status: "REJECTED", job };
      }
      throw error;
    }
  }

  async getJob(jobId: string): Promise<AgentServiceJob> {
    return this.requireJob(jobId);
  }

  private async advanceToObservation(
    job: AgentServiceJob,
    observation: RescueMonitorObservation,
    patch: TransitionPatch = {},
  ): Promise<AgentServiceJob> {
    let next = job;
    const expectedRevision = job.revision;

    if (observation.phase === "WAITING_FOR_USER") {
      if (next.status !== "WAITING_FOR_USER") {
        throw new Error("Monitor observation would regress the rescue lifecycle");
      }
      return this.updateJob(next, { ...patch, monitor: observation }, expectedRevision);
    }

    if (next.status === "WAITING_FOR_USER") {
      next = transitionJob(next, "SIGNING", "SIGNING_OBSERVED", this.now());
    }
    if (observation.phase === "SIGNING") {
      if (next.status !== "SIGNING") {
        throw new Error("Monitor observation would regress the rescue lifecycle");
      }
      return this.updateJob(next, { ...patch, monitor: observation }, expectedRevision);
    }

    if (next.status === "SIGNING") {
      next = transitionJob(next, "EXECUTING", "EXECUTION_OBSERVED", this.now());
    }
    if (observation.phase === "EXECUTING") {
      if (next.status !== "EXECUTING") {
        throw new Error("Monitor observation would regress the rescue lifecycle");
      }
      return this.updateJob(next, { ...patch, monitor: observation }, expectedRevision);
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
      transitionJob(next, target[0], target[1], this.now(), { ...patch, monitor: observation }),
      expectedRevision,
    );
  }

  private reportForReceiptSubmission(
    job: AgentServiceJob,
    submission: BuyerReceiptRegistration,
  ): BuyerExecutionReport {
    const signingPackage = (job.signingPackages ?? (job.signingPackage ? [job.signingPackage] : []))
      .find((candidate) => candidate.packageId === submission.packageId);
    const simulation = job.simulation?.results.find(
      (result) => result.id === signingPackage?.simulation.resultId,
    );
    if (!signingPackage || !simulation) {
      throw new Error("Receipt submission is missing its issued package or simulation commitment");
    }
    return buyerExecutionReportSchema.parse({
      schemaVersion: "safeexit-buyer-report-v1",
      packageId: signingPackage.packageId,
      jobId: job.id,
      incidentId: signingPackage.incidentId,
      planId: signingPackage.planId,
      planHash: signingPackage.planHash,
      actionId: signingPackage.actionId,
      route: signingPackage.route,
      chainId: signingPackage.chainId,
      sourceAddress: signingPackage.sourceAddress,
      destinationAddress: signingPackage.destinationAddress,
      status: "COMPLETED",
      simulationProviderId: simulation.providerId,
      simulatedAt: simulation.simulatedAt,
      transactionHashes: [submission.transactionHash],
      completedAt: this.now(),
    });
  }

  private confirmedReceiptPatch(
    job: AgentServiceJob,
    packageId: string,
    transactionHashes: readonly string[],
  ): TransitionPatch {
    const hashes = new Set(transactionHashes.map((hash) => hash.toLowerCase()));
    let changed = false;
    const at = this.now();
    const receiptSubmissions = job.receiptSubmissions?.map((submission) => {
      if (
        submission.packageId !== packageId ||
        !hashes.has(submission.transactionHash.toLowerCase()) ||
        submission.status === "CONFIRMED"
      ) {
        return submission;
      }
      changed = true;
      return { ...submission, status: "CONFIRMED" as const, updatedAt: at };
    });
    return changed && receiptSubmissions ? { receiptSubmissions } : {};
  }

  private async setReceiptSubmissionStatus(
    job: AgentServiceJob,
    input: BuyerReceiptRegistration,
    status: Extract<BuyerReceiptSubmissionStatus, "REVERTED" | "REJECTED">,
  ): Promise<AgentServiceJob> {
    return this.retryJobMutation(job.id, (current) => {
      const at = this.now();
      return this.updateJob(current, {
        receiptSubmissions: current.receiptSubmissions?.map((submission) =>
          submission.packageId === input.packageId &&
          submission.transactionHash.toLowerCase() === input.transactionHash.toLowerCase()
            ? { ...submission, status, updatedAt: at }
            : submission),
      });
    }, job);
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

  private validateSigningPackage(job: AgentServiceJob, value: SigningPackage): void {
    if (!job.incident || !job.plan || !job.simulation) {
      throw new Error("Signing package validation requires incident, plan, and simulation state");
    }
    if (
      value.jobId !== job.id ||
      value.incidentId !== job.incident.id ||
      value.planId !== job.plan.id ||
      value.planHash.toLowerCase() !== job.plan.integrityHash.toLowerCase() ||
      value.chainId !== job.plan.chainId ||
      value.sourceAddress.toLowerCase() !== job.plan.sourceAddress.toLowerCase() ||
      value.destinationAddress.toLowerCase() !== job.plan.destinationAddress.toLowerCase() ||
      value.observedAtBlock !== job.plan.observedAtBlock
    ) {
      throw new Error("Signing package does not match the simulated rescue scope");
    }
    if (!job.simulation.executableActionIds.includes(value.actionId)) {
      throw new Error("Signing package action was not approved by simulation");
    }
    const action = job.plan.actions.find((candidate) => candidate.id === value.actionId);
    const simulation = job.simulation.results.find(
      (candidate) => candidate.id === value.simulation.resultId,
    );
    if (
      !action ||
      !simulation ||
      simulation.actionId !== action.id ||
      simulation.status !== "SUCCEEDED" ||
      simulation.providerId !== value.simulation.providerId ||
      simulation.expiresAt !== value.simulation.expiresAt
    ) {
      throw new Error("Signing package simulation commitment is invalid");
    }
    const packageExpiry = Date.parse(value.expiresAt);
    const simulationExpiry = Date.parse(simulation.expiresAt);
    if (packageExpiry > simulationExpiry || packageExpiry <= this.clock().getTime()) {
      throw new Error("Signing package must expire before its live simulation");
    }
    if (value.route === "ERC4494_PERMIT_SETTLEMENT") {
      if (
        action.actionType !== "TRANSFER_ERC721" ||
        value.collectionAddress.toLowerCase() !== action.parameters.collectionAddress.toLowerCase() ||
        value.tokenId !== action.parameters.tokenId
      ) {
        throw new Error("NFT signing package does not match its rescue action");
      }
      return;
    }
    if (
      action.actionType !== "TRANSFER_ERC20" ||
      value.tokenAddress.toLowerCase() !== action.parameters.tokenAddress.toLowerCase() ||
      value.amount !== action.parameters.amount
    ) {
      throw new Error("Token signing package does not match its rescue action");
    }
  }

  private validateBuyerReportScope(
    job: AgentServiceJob,
    report: BuyerExecutionReport,
  ): SigningPackage {
    const signingPackage = (job.signingPackages ?? (job.signingPackage ? [job.signingPackage] : []))
      .find((candidate) => candidate.packageId === report.packageId);
    if (
      !signingPackage ||
      report.jobId !== job.id ||
      report.packageId !== signingPackage.packageId ||
      report.incidentId !== signingPackage.incidentId ||
      report.planId !== signingPackage.planId ||
      report.planHash.toLowerCase() !== signingPackage.planHash.toLowerCase() ||
      report.actionId !== signingPackage.actionId ||
      report.route !== signingPackage.route ||
      report.chainId !== signingPackage.chainId ||
      report.sourceAddress.toLowerCase() !== signingPackage.sourceAddress.toLowerCase() ||
      report.destinationAddress.toLowerCase() !== signingPackage.destinationAddress.toLowerCase()
    ) {
      throw new Error("Buyer execution report does not match the issued signing package");
    }
    return signingPackage;
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
    patch: Partial<Pick<AgentServiceJob, "incident" | "scan" | "simulation" | "signingPackage" | "signingPackages" | "receiptSubmissions" | "monitor" | "dashboardUrl">>,
    expectedRevision = job.revision,
  ): Promise<AgentServiceJob> {
    const at = this.now();
    return this.store.save(
      agentServiceJobSchema.parse({
        ...job,
        ...patch,
        revision: job.revision + 1,
        updatedAt: at,
      }),
      expectedRevision,
    );
  }

  private async retryJobMutation(
    jobId: string,
    mutate: (job: AgentServiceJob) => Promise<AgentServiceJob>,
    initialJob?: AgentServiceJob,
  ): Promise<AgentServiceJob> {
    const maximumAttempts = 5;
    for (let attempt = 0; attempt < maximumAttempts; attempt += 1) {
      const job = attempt === 0 && initialJob ? initialJob : await this.requireJob(jobId);
      try {
        return await mutate(job);
      } catch (error) {
        if (!(error instanceof AgentJobRevisionConflictError) || attempt === maximumAttempts - 1) {
          throw error;
        }
      }
    }
    throw new AgentJobRevisionConflictError(jobId);
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
