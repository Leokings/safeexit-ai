export type NativeRecoveryStrategy =
  | "EIP7702_SPONSORED_EXECUTION"
  | "PRIVATE_ATOMIC_BUNDLE";

export type NativeRecoveryBoundary = {
  strategy: NativeRecoveryStrategy;
  status: "INTERNALLY_VERIFIED" | "OFFICIAL_DOCS_REQUIRED";
  executable: boolean;
  supportedChainIds: readonly number[];
  requirements: readonly string[];
  residualRisks: readonly string[];
};

export const nativeRecoveryBoundaries = [
  {
    strategy: "EIP7702_SPONSORED_EXECUTION",
    status: "INTERNALLY_VERIFIED",
    executable: true,
    supportedChainIds: [196],
    requirements: [
      "The package must use the bytecode-pinned SafeExit V2 factory on X Layer",
      "The local signer must verify the factory prediction through both official X Layer RPC endpoints",
      "The source must sign one delegation and one clearing authorization locally",
      "A fresh capped temporary payer funded by the destination must submit the type-4 sequence",
      "Every action must pass fresh deterministic simulation and clearing must be observed canonically",
    ],
    residualRisks: [
      "The current route uses the public X Layer mempool and is not a private bundle",
      "The source key remains compromised after rescue and the wallet must not be reused",
      "The V2 route has internal review and mainnet evidence but no independent external audit",
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
    residualRisks: [
      "No official X Layer private atomic bundle adapter is configured",
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
