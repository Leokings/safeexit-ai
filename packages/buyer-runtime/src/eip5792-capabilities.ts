export const XLAYER_MAINNET_HEX_CHAIN_ID = "0xc4" as const;

export type Eip5792CapabilityAssessmentStatus =
  | "NOT_ADVERTISED"
  | "WALLET_MANAGED_ATOMIC_ONLY"
  | "UNVERIFIED_EXTENDED_CAPABILITIES";

export type Eip5792CapabilityAssessment = Readonly<{
  status: Eip5792CapabilityAssessmentStatus;
  chainAdvertised: boolean;
  atomicStatus?: string;
  walletManagedAtomicCalls: boolean;
  eip7702AuthorizationAdvertised: boolean;
  paymasterServiceAdvertised: boolean;
  safeExitDestinationPaidReady: false;
  capabilityKeys: readonly string[];
  reason: string;
}>;

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function advertised(
  capabilities: Record<string, unknown>,
  key: string,
): boolean {
  return (
    Object.prototype.hasOwnProperty.call(capabilities, key) &&
    capabilities[key] !== false &&
    capabilities[key] !== null
  );
}

function capabilityStatus(
  capabilities: Record<string, unknown>,
  key: string,
): string | undefined {
  const capability = record(capabilities[key]);
  return typeof capability?.status === "string"
    ? capability.status.toLowerCase()
    : undefined;
}

export function assessEip5792Capabilities(
  value: unknown,
  chainIdHex = XLAYER_MAINNET_HEX_CHAIN_ID,
): Eip5792CapabilityAssessment {
  const capabilitiesByChain = record(value);
  const normalizedChainId = chainIdHex.toLowerCase();
  const chainCapabilities = record(
    capabilitiesByChain
      ? Object.entries(capabilitiesByChain).find(
          ([candidate]) => candidate.toLowerCase() === normalizedChainId,
        )?.[1]
      : undefined,
  );

  if (!chainCapabilities) {
    return {
      status: "NOT_ADVERTISED",
      chainAdvertised: false,
      walletManagedAtomicCalls: false,
      eip7702AuthorizationAdvertised: false,
      paymasterServiceAdvertised: false,
      safeExitDestinationPaidReady: false,
      capabilityKeys: [],
      reason:
        "The wallet did not advertise EIP-5792 support for X Layer mainnet.",
    };
  }

  const atomicStatus = capabilityStatus(chainCapabilities, "atomic");
  const walletManagedAtomicCalls =
    atomicStatus === "ready" || atomicStatus === "supported";
  const eip7702AuthorizationAdvertised = advertised(
    chainCapabilities,
    "eip7702Auth",
  );
  const paymasterServiceAdvertised = advertised(
    chainCapabilities,
    "paymasterService",
  );
  const capabilityKeys = Object.keys(chainCapabilities).sort();

  if (
    eip7702AuthorizationAdvertised ||
    paymasterServiceAdvertised
  ) {
    return {
      status: "UNVERIFIED_EXTENDED_CAPABILITIES",
      chainAdvertised: true,
      ...(atomicStatus ? { atomicStatus } : {}),
      walletManagedAtomicCalls,
      eip7702AuthorizationAdvertised,
      paymasterServiceAdvertised,
      safeExitDestinationPaidReady: false,
      capabilityKeys,
      reason:
        "The wallet advertised extended capabilities, but SafeExit has no " +
        "officially documented adapter proving a raw source authorization can " +
        "be handed to a separate destination-paid type-4 submitter.",
    };
  }

  if (walletManagedAtomicCalls) {
    return {
      status: "WALLET_MANAGED_ATOMIC_ONLY",
      chainAdvertised: true,
      atomicStatus,
      walletManagedAtomicCalls: true,
      eip7702AuthorizationAdvertised: false,
      paymasterServiceAdvertised: false,
      safeExitDestinationPaidReady: false,
      capabilityKeys,
      reason:
        "The wallet supports wallet-managed atomic calls, but it does not " +
        "advertise the raw authorization and external payer capabilities " +
        "required by SafeExit's destination-paid route.",
    };
  }

  return {
    status: "NOT_ADVERTISED",
    chainAdvertised: true,
    ...(atomicStatus ? { atomicStatus } : {}),
    walletManagedAtomicCalls: false,
    eip7702AuthorizationAdvertised: false,
    paymasterServiceAdvertised: false,
    safeExitDestinationPaidReady: false,
    capabilityKeys,
    reason:
      "The wallet returned an X Layer capability record without a supported " +
      "atomic-call status or a verified SafeExit destination-paid route.",
  };
}
