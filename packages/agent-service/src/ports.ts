import type { Incident, RescuePlan, WalletScan } from "@safeexit/shared";

import type {
  AgentServiceJob,
  AgentSimulationReport,
  RescueMonitorObservation,
} from "./schemas";
import type { SigningPackage } from "./signing-package";
import type { BuyerExecutionReport } from "./buyer-report";

export interface IncidentAnalyzerPort {
  analyse(incident: Incident): Promise<WalletScan>;
}

export interface RescuePlanGeneratorPort {
  generate(incident: Incident, scan: WalletScan): Promise<RescuePlan>;
}

export interface RescuePlanSimulatorPort {
  simulate(plan: RescuePlan): Promise<AgentSimulationReport>;
}

export interface DashboardLocatorPort {
  getDashboardUrl(job: AgentServiceJob): string;
}

export interface SigningPackageBuilderPort {
  build(job: AgentServiceJob): Promise<SigningPackage>;
  buildAll?(job: AgentServiceJob): Promise<readonly SigningPackage[]>;
}

export interface BuyerExecutionVerifierPort {
  verify(job: AgentServiceJob, report: BuyerExecutionReport): Promise<RescueMonitorObservation>;
}

// Monitoring observes local signatures, submissions, and receipts. It does not execute them.
export interface RescueMonitorPort {
  observe(job: AgentServiceJob): Promise<RescueMonitorObservation>;
}

export class SafeExitDashboardLocator implements DashboardLocatorPort {
  private readonly baseUrl: URL;

  constructor(baseUrl: string) {
    this.baseUrl = new URL(baseUrl);
  }

  getDashboardUrl(job: AgentServiceJob): string {
    return new URL(`/rescue/${encodeURIComponent(job.id)}`, this.baseUrl).toString();
  }
}
