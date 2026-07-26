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

export type Eip5792CapabilityEvidence = Readonly<{
  schemaVersion: "safeexit-eip5792-capability-evidence-v1";
  walletAddress: `0x${string}`;
  checkedChainIdHex: string;
  checkedAt: string;
  method: "wallet_getCapabilities";
  readOnly: true;
  assessment: Eip5792CapabilityAssessment;
  advertisedCapabilities: unknown;
  retainedSensitiveMaterial: Readonly<{
    signature: false;
    authorization: false;
    rawTransaction: false;
    privateKey: false;
    seedPhrase: false;
    mnemonic: false;
  }>;
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

function isSensitiveEvidenceKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
  return [
    "signature",
    "authorization",
    "rawtransaction",
    "signedtransaction",
    "privatekey",
    "seed",
    "seedphrase",
    "mnemonic",
  ].some((fragment) => normalized.includes(fragment));
}

export function sanitizeEip5792CapabilityEvidence(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeEip5792CapabilityEvidence(entry));
  }

  const source = record(value);
  if (!source) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(source).map(([key, entry]) => [
      key,
      isSensitiveEvidenceKey(key)
        ? "[REDACTED]"
        : sanitizeEip5792CapabilityEvidence(entry),
    ]),
  );
}

export function assessEip5792Capabilities(
  value: unknown,
  chainIdHex: string = XLAYER_MAINNET_HEX_CHAIN_ID,
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

export function createEip5792CapabilityEvidence(input: Readonly<{
  walletAddress: `0x${string}`;
  capabilities: unknown;
  checkedChainIdHex?: string;
  checkedAt?: string;
}>): Eip5792CapabilityEvidence {
  const checkedChainIdHex =
    input.checkedChainIdHex ?? XLAYER_MAINNET_HEX_CHAIN_ID;

  return {
    schemaVersion: "safeexit-eip5792-capability-evidence-v1",
    walletAddress: input.walletAddress,
    checkedChainIdHex,
    checkedAt: input.checkedAt ?? new Date().toISOString(),
    method: "wallet_getCapabilities",
    readOnly: true,
    assessment: assessEip5792Capabilities(
      input.capabilities,
      checkedChainIdHex,
    ),
    advertisedCapabilities: sanitizeEip5792CapabilityEvidence(
      input.capabilities,
    ),
    retainedSensitiveMaterial: {
      signature: false,
      authorization: false,
      rawTransaction: false,
      privateKey: false,
      seedPhrase: false,
      mnemonic: false,
    },
  };
}
