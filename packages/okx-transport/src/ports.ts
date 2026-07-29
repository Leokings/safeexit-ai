import type {
  AgentServiceJob,
  BuyerExecutionReport,
  Eip7702LocalSigningPackage,
  SigningPackage,
} from "@safeexit/agent-service";
import type { Incident } from "@safeexit/shared";

export interface SafeExitAgentLifecyclePort {
  createIncident(input: {
    requestId: string;
    incident: Incident;
  }): Promise<AgentServiceJob>;
  analyseIncident(jobId: string, incident?: Incident): Promise<AgentServiceJob>;
  generatePlan(jobId: string): Promise<AgentServiceJob>;
  simulatePlan(jobId: string): Promise<AgentServiceJob>;
  getSigningPackage(jobId: string): Promise<SigningPackage>;
  getSigningPackages(jobId: string): Promise<SigningPackage[]>;
  getJob(jobId: string): Promise<AgentServiceJob>;
  recordBuyerExecutionReport(
    jobId: string,
    report: BuyerExecutionReport,
  ): Promise<AgentServiceJob>;
}

export interface Eip7702SigningPackageBuilderPort {
  build(job: AgentServiceJob): Promise<Eip7702LocalSigningPackage>;
}
