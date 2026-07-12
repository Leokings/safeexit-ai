import type { RescueAction, RescuePlan, SimulationResult } from "@safeexit/shared";
import { verifyPlanIntegrity } from "@safeexit/planner";

import { createSimulationResult } from "./result";
import type { SimulationProvider, SimulationRequest } from "./types";

export type ExcludedSimulationAction = {
  actionId: string;
  status: Exclude<SimulationResult["status"], "SUCCEEDED">;
  reason: string;
};

export type PlanSimulationReport = {
  planId: string;
  planHash: `0x${string}`;
  providerId: string;
  status: "SUCCEEDED" | "PARTIAL" | "FAILED";
  results: readonly SimulationResult[];
  executableActions: readonly RescueAction[];
  excludedActions: readonly ExcludedSimulationAction[];
};

export type SimulatePlanOptions = {
  clock?: () => Date;
};

export async function simulateRescuePlan(
  plan: RescuePlan,
  provider: SimulationProvider,
  options: SimulatePlanOptions = {},
): Promise<PlanSimulationReport> {
  if (!verifyPlanIntegrity(plan)) {
    throw new Error("Rescue plan integrity verification failed");
  }

  const clock = options.clock ?? (() => new Date());
  const planHash = plan.integrityHash as `0x${string}`;
  const results: SimulationResult[] = [];
  const successfulActionIds = new Set<string>();
  let cumulativeGasEstimate = 0n;

  for (const action of plan.actions) {
    const failedDependency = action.dependencies.find(
      (dependency) => !successfulActionIds.has(dependency),
    );
    const request: SimulationRequest = {
      planId: plan.id,
      planHash,
      action,
      observedAtBlock: plan.observedAtBlock,
      ...(cumulativeGasEstimate > 0n
        ? { priorGasEstimate: cumulativeGasEstimate.toString() }
        : {}),
    };

    let result: SimulationResult;
    if (failedDependency) {
      result = createSimulationResult({
        providerId: provider.id,
        request,
        status: "UNSUPPORTED",
        failureReason: `Dependency ${failedDependency} did not simulate successfully`,
        clock,
        ttlMs: 60_000,
      });
    } else {
      try {
        const support = await provider.supports(plan.chainId, action);
        result = support.supported
          ? await provider.simulate(request)
          : createSimulationResult({
              providerId: provider.id,
              request,
              status: "UNSUPPORTED",
              failureReason:
                support.reason ?? "Simulation provider does not support this action",
              clock,
              ttlMs: 60_000,
            });
      } catch (error) {
        result = createSimulationResult({
          providerId: provider.id,
          request,
          status: "ERROR",
          failureReason:
            error instanceof Error ? error.message : "Simulation provider failed",
          clock,
          ttlMs: 60_000,
        });
      }
    }

    results.push(result);
    if (result.status === "SUCCEEDED") {
      successfulActionIds.add(action.id);
      cumulativeGasEstimate += BigInt(result.gasEstimate ?? "0");
    }
  }

  const executableActions = plan.actions.filter((action) =>
    successfulActionIds.has(action.id),
  );
  const excludedActions = results.flatMap((result) =>
    result.status === "SUCCEEDED"
      ? []
      : [
          {
            actionId: result.actionId,
            status: result.status,
            reason: result.failureReason ?? "Simulation did not succeed",
          },
        ],
  );

  return {
    planId: plan.id,
    planHash,
    providerId: provider.id,
    status:
      executableActions.length === plan.actions.length
        ? "SUCCEEDED"
        : executableActions.length > 0
          ? "PARTIAL"
          : "FAILED",
    results,
    executableActions,
    excludedActions,
  };
}
