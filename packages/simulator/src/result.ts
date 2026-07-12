import { keccak256, toBytes } from "viem";

import {
  simulationResultSchema,
  type SimulationAssetChange,
  type SimulationResult,
} from "@safeexit/shared";

import type { SimulationRequest } from "./types";

export type CreateSimulationResultInput = {
  providerId: string;
  request: SimulationRequest;
  status: SimulationResult["status"];
  clock: () => Date;
  ttlMs: number;
  gasEstimate?: bigint;
  assetChanges?: readonly SimulationAssetChange[];
  warnings?: readonly string[];
  failureReason?: string;
};

export function createSimulationResult(
  input: CreateSimulationResultInput,
): SimulationResult {
  const simulatedAt = input.clock();
  const resultId = keccak256(
    toBytes(
      `${input.providerId}:${input.request.planId}:${input.request.action.id}:${input.request.observedAtBlock}`,
    ),
  );

  return simulationResultSchema.parse({
    id: `simulation:${resultId}`,
    planId: input.request.planId,
    actionId: input.request.action.id,
    providerId: input.providerId,
    status: input.status,
    planHash: input.request.planHash,
    observedAtBlock: input.request.observedAtBlock,
    ...(input.gasEstimate !== undefined
      ? { gasEstimate: input.gasEstimate.toString() }
      : {}),
    expectedEffects: input.request.action.expectedEffects,
    assetChanges: [...(input.assetChanges ?? [])],
    warnings: [...(input.warnings ?? [])],
    ...(input.failureReason ? { failureReason: input.failureReason.slice(0, 1_000) } : {}),
    simulatedAt: simulatedAt.toISOString(),
    expiresAt: new Date(simulatedAt.getTime() + input.ttlMs).toISOString(),
  });
}

