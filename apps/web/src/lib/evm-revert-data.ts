import type { Hex } from "viem";

const revertDataPattern = /^0x(?:[0-9a-fA-F]{2})*$/;

export function findEvmRevertData(error: unknown): Hex | undefined {
  const pending = [error];
  const visited = new Set<unknown>();

  while (pending.length > 0) {
    const current = pending.shift();
    if (!current || typeof current !== "object" || visited.has(current)) {
      continue;
    }
    visited.add(current);

    const candidate = current as { cause?: unknown; data?: unknown; error?: unknown };
    if (
      typeof candidate.data === "string" &&
      revertDataPattern.test(candidate.data)
    ) {
      return candidate.data as Hex;
    }
    pending.push(candidate.cause, candidate.error);
  }

  return undefined;
}

export function hasNonEmptyEvmRevertData(error: unknown): boolean {
  const data = findEvmRevertData(error);
  return data !== undefined && data.length > 2;
}
