import {
  type OkxX402PrepareRequest,
  okxX402SigningDeliverableSchema,
} from "@safeexit/okx-transport";

import {
  answerAgentJobQuestion,
  SAFEEXIT_PAID_ANALYSIS_QUESTION,
} from "./agent-ai";
import { getAgentIncidentService } from "./agent-runtime";
import { parseDeploymentEnvironment } from "./deployment-env";
import { getOkxProviderBridge } from "./okx-provider-bridge";
import { issuePaidContinuation } from "./paid-continuation";

export async function preparePaidRescueDeliverable(input: OkxX402PrepareRequest) {
  const environment = parseDeploymentEnvironment();
  const service = getAgentIncidentService({
    chainId: input.walletContext.chainId,
    ...(input.assetManifest ? { assetManifest: input.assetManifest } : {}),
  });
  const deliverable = await getOkxProviderBridge().preparePaidSigningDeliverable(
    service,
    input,
  );
  const job = await service.getJob(deliverable.safeExitJobId);
  if (!job.incident) {
    throw new Error("Paid SAFEEXIT job is missing its incident scope");
  }
  const analysis = await answerAgentJobQuestion(
    job,
    SAFEEXIT_PAID_ANALYSIS_QUESTION,
    environment,
  );
  return okxX402SigningDeliverableSchema.parse({
    ...deliverable,
    dashboardUrl: new URL(
      `/rescue/${encodeURIComponent(job.incident.id)}`,
      environment.publicBaseUrl,
    ).toString(),
    continuation: issuePaidContinuation(environment, {
      requestId: input.requestId,
      safeExitJobId: deliverable.safeExitJobId,
      providerAgentId: deliverable.providerAgentId,
      chainId: deliverable.walletContext.chainId,
    }),
    incidentAnalysis: {
      authority: "EXPLANATION_ONLY",
      executablePlanSource: "DETERMINISTIC",
      mode: analysis.mode,
      fallbackUsed: analysis.fallbackUsed,
      ...(environment.aiMode === "GATEWAY" && environment.aiModel
        ? { modelId: environment.aiModel }
        : {}),
      response: analysis.response,
    },
  });
}
