export type NativeRecoveryStrategy =
  | "EIP7702_SPONSORED_EXECUTION"
  | "PRIVATE_ATOMIC_BUNDLE";

export type NativeRecoveryBoundary = {
  strategy: NativeRecoveryStrategy;
  status: "IMPLEMENTATION_TESTING" | "OFFICIAL_DOCS_REQUIRED";
  executable: false;
  supportedChainIds: readonly number[];
  requirements: readonly string[];
};

export const nativeRecoveryBoundaries = [
  {
    strategy: "EIP7702_SPONSORED_EXECUTION",
    status: "IMPLEMENTATION_TESTING",
    executable: false,
    supportedChainIds: [196],
    requirements: [
      "A bytecode-verified incident-bound delegate deployment on X Layer",
      "A reviewed local signer or official wallet method that displays the exact delegate and chain",
      "The destination-paid local type-4 runtime must pass an X Layer no-value canary",
      "A private submission policy for the delegation, rescue, and clear sequence",
      "Full type-4 integration testing plus a verified delegation-revocation receipt",
    ],
  },
  {
    strategy: "PRIVATE_ATOMIC_BUNDLE",
    status: "OFFICIAL_DOCS_REQUIRED",
    executable: false,
    supportedChainIds: [],
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
