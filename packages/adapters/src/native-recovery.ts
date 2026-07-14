export type NativeRecoveryStrategy =
  | "EIP7702_SPONSORED_EXECUTION"
  | "PRIVATE_ATOMIC_BUNDLE";

export type NativeRecoveryBoundary = {
  strategy: NativeRecoveryStrategy;
  status: "OFFICIAL_DOCS_REQUIRED";
  executable: false;
  requirements: readonly string[];
};

export const nativeRecoveryBoundaries = [
  {
    strategy: "EIP7702_SPONSORED_EXECUTION",
    status: "OFFICIAL_DOCS_REQUIRED",
    executable: false,
    requirements: [
      "Official target-chain support for EIP-7702 set-code transactions",
      "An audited and bytecode-allowlisted delegate implementation",
      "An official wallet authorization method that never accepts arbitrary delegate code",
      "A sponsor path that binds chain, nonce, target, calldata, value, gas, and expiry",
      "Deterministic simulation plus a tested delegation-revocation procedure",
    ],
  },
  {
    strategy: "PRIVATE_ATOMIC_BUNDLE",
    status: "OFFICIAL_DOCS_REQUIRED",
    executable: false,
    requirements: [
      "An official target-chain private relay endpoint and authentication contract",
      "Documented all-or-nothing ordering for sponsor and rescue transactions",
      "A strict prohibition on public-mempool fallback",
      "Pinned-state bundle simulation and inclusion-status monitoring",
      "A sponsor policy that cannot choose arbitrary source targets or calldata",
    ],
  },
] as const satisfies readonly NativeRecoveryBoundary[];

export function getNativeRecoveryBoundary(
  strategy: NativeRecoveryStrategy,
): NativeRecoveryBoundary {
  const boundary = nativeRecoveryBoundaries.find((candidate) =>
    candidate.strategy === strategy
  );
  if (!boundary) {
    throw new Error(`Unknown native recovery strategy: ${strategy}`);
  }
  return boundary;
}
