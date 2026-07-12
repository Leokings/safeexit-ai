import { keccak256, toBytes } from "viem";

import { rescuePlanSchema, type RescuePlan } from "@safeexit/shared";

type PlanIntegrityPayload = Omit<RescuePlan, "integrityHash">;

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }

  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalize(child)]),
    );
  }

  return value;
}

export function computePlanIntegrityHash(payload: PlanIntegrityPayload): `0x${string}` {
  return keccak256(toBytes(JSON.stringify(canonicalize(payload))));
}

export function verifyPlanIntegrity(value: unknown): value is RescuePlan {
  const parsed = rescuePlanSchema.safeParse(value);
  if (!parsed.success) {
    return false;
  }

  const { integrityHash, ...payload } = parsed.data;
  return computePlanIntegrityHash(payload) === integrityHash.toLowerCase();
}

export function deepFreezePlan(plan: RescuePlan): RescuePlan {
  const freeze = (value: unknown): void => {
    if (value === null || typeof value !== "object" || Object.isFrozen(value)) {
      return;
    }

    for (const child of Object.values(value)) {
      freeze(child);
    }
    Object.freeze(value);
  };

  freeze(plan);
  return plan;
}

