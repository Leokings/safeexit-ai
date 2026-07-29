import {
  buildEip7702AuthorizationPair,
  encodeEip7702ExecutionCall,
} from "@safeexit/adapters/eip7702-rescue";
import {
  eip7702LocalSigningPackageSchema,
  toRuntimeEip7702Actions,
  type Eip7702LocalSigningPackage,
} from "@safeexit/agent-service/eip7702-signing-package";
import {
  getAddress,
  zeroAddress,
  type AuthorizationRequest,
  type Hex,
  type SignedAuthorization,
} from "viem";
import { recoverAuthorizationAddress } from "viem/utils";

import type { DestinationReceipt } from "./schemas";
import { buyerConfirmationSchema, destinationReceiptSchema } from "./schemas";
import type { TrustedEip7702Factory } from "./eip7702-trust";

export { XLAYER_SAFEEXIT_EIP7702_FACTORY_V2 } from "./eip7702-trust";
export type { TrustedEip7702Factory } from "./eip7702-trust";

const EMPTY_CODE = "0x";
const MAXIMUM_PACKAGE_WINDOW_MS = 15 * 60 * 1_000;

export type Eip7702RuntimeErrorCode =
  | "INVALID_CONFIRMATION"
  | "PACKAGE_EXPIRED"
  | "DESTINATION_MISMATCH"
  | "CHAIN_MISMATCH"
  | "SOURCE_MISMATCH"
  | "STALE_SOURCE_NONCE"
  | "FACTORY_MISMATCH"
  | "DELEGATE_MISMATCH"
  | "SOURCE_ALREADY_DELEGATED"
  | "INVALID_AUTHORIZATION"
  | "INVALID_HANDLE"
  | "DEPLOYMENT_FAILED"
  | "SIMULATION_FAILED"
  | "SUBMISSION_FAILED"
  | "DELEGATION_NOT_CLEARED";

export class Eip7702RuntimeError extends Error {
  constructor(
    readonly code: Eip7702RuntimeErrorCode,
    message: string,
    readonly transactionHashes: readonly Hex[] = [],
  ) {
    super(message);
    this.name = "Eip7702RuntimeError";
  }
}

export type Eip7702DelegateState = {
  chainId: number;
  sourceAddress: `0x${string}`;
  destinationAddress: `0x${string}`;
  deadline: number;
  planHash: Hex;
  rescueNonce: Hex;
};

export type Eip7702PackageInspection = {
  sourceNonce: number;
  sourceCode: Hex;
  factoryRuntimeHash: Hex;
  predictedDelegateAddress: `0x${string}`;
  delegateState?: Eip7702DelegateState;
};

export type Eip7702LocalTransactionRequest = {
  purpose: "RESCUE_ACTION" | "CLEAR_DELEGATION";
  chainId: number;
  from: `0x${string}`;
  to: `0x${string}`;
  value: 0n;
  data: Hex;
  authorizationList?: readonly SignedAuthorization[];
  actionIndex?: number;
};

export type Eip7702LocalSimulation = {
  status: "SUCCEEDED" | "FAILED";
  providerId: string;
  simulatedAt: string;
  failureReason?: string;
};

export interface Eip7702SourceAuthorizationSignerPort {
  getAddress(): Promise<`0x${string}`>;
  signAuthorization(request: AuthorizationRequest): Promise<SignedAuthorization>;
}

export interface Eip7702DestinationTransportPort {
  getAddress(): Promise<`0x${string}`>;
  getChainId(): Promise<number>;
  inspect(
    signingPackage: Eip7702LocalSigningPackage,
  ): Promise<Eip7702PackageInspection>;
  deployDelegate(signingPackage: Eip7702LocalSigningPackage): Promise<Hex>;
  simulate(
    request: Eip7702LocalTransactionRequest,
  ): Promise<Eip7702LocalSimulation>;
  submit(request: Eip7702LocalTransactionRequest): Promise<Hex>;
  waitForInclusion(hash: Hex): Promise<DestinationReceipt>;
  waitForReceipt(hash: Hex): Promise<DestinationReceipt>;
}

type ProvisionedState = {
  signingPackage: Eip7702LocalSigningPackage;
  destination: Eip7702DestinationTransportPort;
  payerAddress: `0x${string}`;
  deploymentHashes: readonly Hex[];
};

type AuthorizedState = ProvisionedState & {
  delegation: SignedAuthorization;
  revocation: SignedAuthorization;
};

export type ProvisionedEip7702Handle = Readonly<{
  summary: Readonly<{
    packageId: string;
    chainId: 196;
    sourceAddress: `0x${string}`;
    destinationAddress: `0x${string}`;
    payerAddress: `0x${string}`;
    delegateAddress: `0x${string}`;
    expiresAt: string;
    deploymentHashes: readonly Hex[];
  }>;
}>;

export type AuthorizedEip7702Handle = Readonly<{
  summary: ProvisionedEip7702Handle["summary"];
}>;

export type Eip7702ActionOutcome = {
  actionId: string;
  actionIndex: number;
  status: "COMPLETED" | "SIMULATION_FAILED" | "TRANSACTION_REVERTED";
  transactionHash?: Hex;
  failureReason?: string;
};

export type Eip7702ExecutionResult = {
  packageId: string;
  route: "EIP7702_DELEGATED_RESCUE";
  chainId: 196;
  sourceAddress: `0x${string}`;
  destinationAddress: `0x${string}`;
  payerAddress: `0x${string}`;
  status: "COMPLETED" | "PARTIAL" | "FAILED";
  sourcePaidGas: false;
  deploymentHashes: readonly Hex[];
  rescueTransactionHashes: readonly Hex[];
  clearTransactionHash?: Hex;
  outcomes: readonly Eip7702ActionOutcome[];
  completedAt: string;
};

export type LocalEip7702RuntimeOptions = {
  trustedFactory: TrustedEip7702Factory;
  clock?: () => Date;
};

const provisionedStates = new WeakMap<ProvisionedEip7702Handle, ProvisionedState>();
const authorizedStates = new WeakMap<AuthorizedEip7702Handle, AuthorizedState>();

function sameAddress(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function delegationCode(delegateAddress: string): Hex {
  return `0xef0100${delegateAddress.slice(2).toLowerCase()}` as Hex;
}

function assertFresh(
  signingPackage: Eip7702LocalSigningPackage,
  now: Date,
): void {
  const expiresAt = Date.parse(signingPackage.expiresAt);
  if (
    !Number.isFinite(expiresAt) ||
    expiresAt <= now.getTime() ||
    expiresAt - now.getTime() > MAXIMUM_PACKAGE_WINDOW_MS
  ) {
    throw new Eip7702RuntimeError(
      "PACKAGE_EXPIRED",
      "The EIP-7702 signing package is expired or exceeds the fifteen-minute window",
    );
  }
}

function assertTrustedFactory(
  signingPackage: Eip7702LocalSigningPackage,
  trustedFactory: TrustedEip7702Factory,
): void {
  if (
    signingPackage.chainId !== trustedFactory.chainId ||
    !sameAddress(signingPackage.factoryAddress, trustedFactory.address) ||
    signingPackage.factoryRuntimeHash.toLowerCase() !==
      trustedFactory.runtimeHash.toLowerCase()
  ) {
    throw new Eip7702RuntimeError(
      "FACTORY_MISMATCH",
      "The signing package does not use the buyer runtime's pinned EIP-7702 factory",
    );
  }
}

function validateConfirmation(
  signingPackage: Eip7702LocalSigningPackage,
  confirmationValue: unknown,
): void {
  const confirmation = buyerConfirmationSchema.parse(confirmationValue);
  if (
    confirmation.packageId !== signingPackage.packageId ||
    confirmation.planHash.toLowerCase() !== signingPackage.planHash.toLowerCase() ||
    confirmation.chainId !== signingPackage.chainId ||
    !sameAddress(confirmation.sourceAddress, signingPackage.sourceAddress) ||
    !sameAddress(confirmation.destinationAddress, signingPackage.destinationAddress)
  ) {
    throw new Eip7702RuntimeError(
      "INVALID_CONFIRMATION",
      "Buyer confirmation does not match the EIP-7702 rescue package",
    );
  }
}

async function assertPayer(
  signingPackage: Eip7702LocalSigningPackage,
  destination: Eip7702DestinationTransportPort,
): Promise<`0x${string}`> {
  if (await destination.getChainId() !== signingPackage.chainId) {
    throw new Eip7702RuntimeError(
      "CHAIN_MISMATCH",
      "The local gas-paying account is connected to the wrong chain",
    );
  }
  const address = getAddress(await destination.getAddress());
  if (sameAddress(address, signingPackage.sourceAddress)) {
    throw new Eip7702RuntimeError(
      "DESTINATION_MISMATCH",
      "The compromised source cannot also be the local gas-paying account",
    );
  }
  return address;
}

function assertDelegateState(
  signingPackage: Eip7702LocalSigningPackage,
  inspection: Eip7702PackageInspection,
): void {
  if (
    inspection.factoryRuntimeHash.toLowerCase() !==
      signingPackage.factoryRuntimeHash.toLowerCase()
  ) {
    throw new Eip7702RuntimeError(
      "FACTORY_MISMATCH",
      "The configured EIP-7702 factory runtime does not match the committed deployment",
    );
  }
  if (
    !sameAddress(
      inspection.predictedDelegateAddress,
      signingPackage.delegateAddress,
    )
  ) {
    throw new Eip7702RuntimeError(
      "DELEGATE_MISMATCH",
      "The factory prediction does not match the committed incident delegate",
    );
  }
  const delegate = inspection.delegateState;
  if (!delegate) {
    throw new Eip7702RuntimeError(
      "DELEGATE_MISMATCH",
      "The incident-bound EIP-7702 delegate is not deployed",
    );
  }
  if (
    delegate.chainId !== signingPackage.chainId ||
    !sameAddress(delegate.sourceAddress, signingPackage.sourceAddress) ||
    !sameAddress(delegate.destinationAddress, signingPackage.destinationAddress) ||
    delegate.deadline !== signingPackage.deadline ||
    delegate.planHash.toLowerCase() !== signingPackage.delegatePlanHash.toLowerCase() ||
    delegate.rescueNonce.toLowerCase() !== signingPackage.rescueNonce.toLowerCase()
  ) {
    throw new Eip7702RuntimeError(
      "DELEGATE_MISMATCH",
      "The deployed delegate immutables do not match the rescue package",
    );
  }
}

function assertInitialSourceState(
  signingPackage: Eip7702LocalSigningPackage,
  inspection: Eip7702PackageInspection,
): void {
  if (inspection.sourceNonce !== signingPackage.sourceNonce) {
    throw new Eip7702RuntimeError(
      "STALE_SOURCE_NONCE",
      "The source nonce changed; discard both authorizations and refresh the rescue package",
    );
  }
  if (inspection.sourceCode !== EMPTY_CODE) {
    throw new Eip7702RuntimeError(
      "SOURCE_ALREADY_DELEGATED",
      "The source already has delegated code; SafeExit will not replace unknown delegation",
    );
  }
}

function sourceIsCanonicallyCleared(
  signingPackage: Eip7702LocalSigningPackage,
  inspection: Eip7702PackageInspection,
): boolean {
  return (
    inspection.sourceCode === EMPTY_CODE &&
    inspection.sourceNonce >= signingPackage.sourceNonce + 2
  );
}

function receiptForHash(
  value: DestinationReceipt,
  expectedHash: Hex,
): DestinationReceipt {
  const receipt = destinationReceiptSchema.parse(value);
  if (
    !receipt.transactionHashes.some(
      (hash) => hash.toLowerCase() === expectedHash.toLowerCase(),
    )
  ) {
    throw new Eip7702RuntimeError(
      "SUBMISSION_FAILED",
      "The canonical receipt does not contain the submitted transaction hash",
      [expectedHash],
    );
  }
  return receipt;
}

function assertSignedAuthorizationMatches(
  signed: SignedAuthorization,
  request: AuthorizationRequest,
): void {
  const requestAddress = "address" in request
    ? request.address
    : request.contractAddress;
  if (
    !requestAddress ||
    !sameAddress(signed.address, requestAddress) ||
    signed.chainId !== request.chainId ||
    signed.nonce !== request.nonce ||
    (signed.yParity !== 0 && signed.yParity !== 1) ||
    !/^0x[a-fA-F0-9]{64}$/.test(signed.r) ||
    !/^0x[a-fA-F0-9]{64}$/.test(signed.s)
  ) {
    throw new Eip7702RuntimeError(
      "INVALID_AUTHORIZATION",
      "The local signer returned an authorization outside the committed scope",
    );
  }
}

async function signAndVerifyAuthorization(
  signer: Eip7702SourceAuthorizationSignerPort,
  request: AuthorizationRequest,
  sourceAddress: string,
): Promise<SignedAuthorization> {
  const signed = await signer.signAuthorization(request);
  assertSignedAuthorizationMatches(signed, request);
  const recovered = await recoverAuthorizationAddress({ authorization: signed });
  if (!sameAddress(recovered, sourceAddress)) {
    throw new Eip7702RuntimeError(
      "INVALID_AUTHORIZATION",
      "The EIP-7702 authorization does not recover to the committed source",
    );
  }
  return signed;
}

export class LocalEip7702RescueRuntime {
  private readonly clock: () => Date;
  private readonly trustedFactory: TrustedEip7702Factory;

  constructor(options: LocalEip7702RuntimeOptions) {
    if (
      options.trustedFactory.chainId !== 196 ||
      !/^0x[a-fA-F0-9]{64}$/.test(options.trustedFactory.runtimeHash) ||
      /^0x0{64}$/i.test(options.trustedFactory.runtimeHash)
    ) {
      throw new Error("The local EIP-7702 runtime requires a pinned X Layer factory");
    }
    this.clock = options.clock ?? (() => new Date());
    this.trustedFactory = Object.freeze({
      chainId: options.trustedFactory.chainId,
      address: getAddress(options.trustedFactory.address),
      runtimeHash: options.trustedFactory.runtimeHash,
    });
  }

  async provision(
    packageValue: Eip7702LocalSigningPackage,
    confirmationValue: unknown,
    destination: Eip7702DestinationTransportPort,
  ): Promise<ProvisionedEip7702Handle> {
    const signingPackage = eip7702LocalSigningPackageSchema.parse(packageValue);
    assertFresh(signingPackage, this.clock());
    assertTrustedFactory(signingPackage, this.trustedFactory);
    validateConfirmation(signingPackage, confirmationValue);
    const payerAddress = await assertPayer(signingPackage, destination);

    let inspection = await destination.inspect(signingPackage);
    assertInitialSourceState(signingPackage, inspection);
    if (
      inspection.factoryRuntimeHash.toLowerCase() !==
        signingPackage.factoryRuntimeHash.toLowerCase() ||
      !sameAddress(
        inspection.predictedDelegateAddress,
        signingPackage.delegateAddress,
      )
    ) {
      assertDelegateState(signingPackage, inspection);
    }

    const deploymentHashes: Hex[] = [];
    if (!inspection.delegateState) {
      const deploymentHash = await destination.deployDelegate(signingPackage);
      const receipt = receiptForHash(
        await destination.waitForInclusion(deploymentHash),
        deploymentHash,
      );
      if (receipt.status !== "CONFIRMED") {
        throw new Eip7702RuntimeError(
          "DEPLOYMENT_FAILED",
          receipt.failureReason,
          [deploymentHash],
        );
      }
      deploymentHashes.push(deploymentHash);
      inspection = await destination.inspect(signingPackage);
      assertInitialSourceState(signingPackage, inspection);
    }
    assertDelegateState(signingPackage, inspection);
    assertFresh(signingPackage, this.clock());

    const summary = Object.freeze({
      packageId: signingPackage.packageId,
      chainId: signingPackage.chainId,
      sourceAddress: getAddress(signingPackage.sourceAddress),
      destinationAddress: getAddress(signingPackage.destinationAddress),
      payerAddress,
      delegateAddress: getAddress(signingPackage.delegateAddress),
      expiresAt: signingPackage.expiresAt,
      deploymentHashes: Object.freeze([...deploymentHashes]),
    });
    const handle = Object.freeze({ summary });
    provisionedStates.set(handle, {
      signingPackage,
      destination,
      payerAddress,
      deploymentHashes,
    });
    return handle;
  }

  async authorize(
    provisionedHandle: ProvisionedEip7702Handle,
    signer: Eip7702SourceAuthorizationSignerPort,
  ): Promise<AuthorizedEip7702Handle> {
    const state = provisionedStates.get(provisionedHandle);
    if (!state) {
      throw new Eip7702RuntimeError(
        "INVALID_HANDLE",
        "The provisioned package is unavailable, consumed, or was serialized",
      );
    }
    const { signingPackage, destination, payerAddress } = state;
    assertFresh(signingPackage, this.clock());
    const currentPayerAddress = await assertPayer(signingPackage, destination);
    if (!sameAddress(currentPayerAddress, payerAddress)) {
      throw new Eip7702RuntimeError(
        "DESTINATION_MISMATCH",
        "The local gas-paying account changed after package provisioning",
      );
    }
    const inspection = await destination.inspect(signingPackage);
    assertInitialSourceState(signingPackage, inspection);
    assertDelegateState(signingPackage, inspection);

    const source = getAddress(await signer.getAddress());
    if (!sameAddress(source, signingPackage.sourceAddress)) {
      throw new Eip7702RuntimeError(
        "SOURCE_MISMATCH",
        "The local authorization signer does not match the committed source",
      );
    }
    const requests = buildEip7702AuthorizationPair({
      chainId: signingPackage.chainId,
      delegateAddress: signingPackage.delegateAddress,
      sourceNonce: signingPackage.sourceNonce,
    });
    const delegation = await signAndVerifyAuthorization(
      signer,
      requests.delegation,
      signingPackage.sourceAddress,
    );
    const revocation = await signAndVerifyAuthorization(
      signer,
      requests.revocation,
      signingPackage.sourceAddress,
    );
    assertFresh(signingPackage, this.clock());

    provisionedStates.delete(provisionedHandle);
    const handle = Object.freeze({ summary: provisionedHandle.summary });
    authorizedStates.set(handle, {
      ...state,
      delegation,
      revocation,
    });
    return handle;
  }

  async execute(
    authorizedHandle: AuthorizedEip7702Handle,
  ): Promise<Eip7702ExecutionResult> {
    const state = authorizedStates.get(authorizedHandle);
    if (!state) {
      throw new Eip7702RuntimeError(
        "INVALID_HANDLE",
        "The local EIP-7702 authorization is unavailable, consumed, or was serialized",
      );
    }
    authorizedStates.delete(authorizedHandle);

    const {
      signingPackage,
      destination,
      delegation,
      revocation,
      deploymentHashes,
      payerAddress,
    } = state;
    assertFresh(signingPackage, this.clock());
    const currentPayerAddress = await assertPayer(signingPackage, destination);
    if (!sameAddress(currentPayerAddress, payerAddress)) {
      throw new Eip7702RuntimeError(
        "DESTINATION_MISMATCH",
        "The local gas-paying account changed before rescue execution",
      );
    }
    const initialInspection = await destination.inspect(signingPackage);
    assertInitialSourceState(signingPackage, initialInspection);
    assertDelegateState(signingPackage, initialInspection);

    const actions = toRuntimeEip7702Actions(signingPackage);
    const rescueHashes: Hex[] = [];
    const outcomes: Eip7702ActionOutcome[] = [];
    let delegationSubmitted = false;
    let rescueError: unknown;
    let clearTransactionHash: Hex | undefined;

    try {
      for (const index of signingPackage.executionIndexes) {
        assertFresh(signingPackage, this.clock());
        const request: Eip7702LocalTransactionRequest = {
          purpose: "RESCUE_ACTION",
          chainId: signingPackage.chainId,
          from: payerAddress,
          to: getAddress(signingPackage.sourceAddress),
          value: 0n,
          data: encodeEip7702ExecutionCall(actions, [index]),
          actionIndex: index,
          ...(delegationSubmitted ? {} : { authorizationList: [delegation] }),
        };
        const simulation = await destination.simulate(request);
        if (simulation.status !== "SUCCEEDED") {
          outcomes.push({
            actionId: signingPackage.actionIds[index]!,
            actionIndex: index,
            status: "SIMULATION_FAILED",
            failureReason: simulation.failureReason ?? "Delegated rescue simulation failed",
          });
          continue;
        }

        const transactionHash = await destination.submit(request);
        rescueHashes.push(transactionHash);
        if (request.authorizationList) {
          // The next transaction from the same destination account is the
          // clearing fallback even if receipt polling or later actions fail.
          delegationSubmitted = true;
        }
        const receipt = receiptForHash(
          await destination.waitForInclusion(transactionHash),
          transactionHash,
        );
        outcomes.push({
          actionId: signingPackage.actionIds[index]!,
          actionIndex: index,
          status: receipt.status === "CONFIRMED"
            ? "COMPLETED"
            : "TRANSACTION_REVERTED",
          transactionHash,
          ...(receipt.status === "FAILED"
            ? { failureReason: receipt.failureReason }
            : {}),
        });

        const delegatedInspection = await destination.inspect(signingPackage);
        if (
          delegatedInspection.sourceNonce !== signingPackage.sourceNonce + 1 ||
          delegatedInspection.sourceCode.toLowerCase() !==
            delegationCode(signingPackage.delegateAddress).toLowerCase()
        ) {
          throw new Eip7702RuntimeError(
            "DELEGATE_MISMATCH",
            "The source delegation changed during rescue execution",
            rescueHashes,
          );
        }
      }
    } catch (error) {
      rescueError = error;
    }

    if (delegationSubmitted) {
      try {
        const clearRequest: Eip7702LocalTransactionRequest = {
          purpose: "CLEAR_DELEGATION",
          chainId: signingPackage.chainId,
          from: payerAddress,
          to: getAddress(signingPackage.sourceAddress),
          value: 0n,
          data: "0x",
          authorizationList: [revocation],
        };
        clearTransactionHash = await destination.submit(clearRequest);
        let clearFailure: unknown;
        try {
          const clearReceipt = receiptForHash(
            await destination.waitForReceipt(clearTransactionHash),
            clearTransactionHash,
          );
          if (clearReceipt.status !== "CONFIRMED") {
            clearFailure = new Error(clearReceipt.failureReason);
          }
        } catch (error) {
          clearFailure = error;
        }
        const clearedInspection = await destination.inspect(signingPackage);
        if (!sourceIsCanonicallyCleared(signingPackage, clearedInspection)) {
          if (clearFailure) throw clearFailure;
          throw new Error("The source delegation was not canonically cleared");
        }
      } catch (error) {
        let clearedDespiteReceiptFailure = false;
        try {
          const clearedInspection = await destination.inspect(signingPackage);
          clearedDespiteReceiptFailure = sourceIsCanonicallyCleared(
            signingPackage,
            clearedInspection,
          );
        } catch {
          // The original clearing failure remains authoritative.
        }
        if (!clearedDespiteReceiptFailure) {
          const clearingFailure =
            error instanceof Error ? error.message : "Delegation clearing failed";
          const rescueFailure =
            rescueError instanceof Error ? rescueError.message : undefined;
          throw new Eip7702RuntimeError(
            "DELEGATION_NOT_CLEARED",
            rescueFailure
              ? `${clearingFailure}; preceding rescue failure: ${rescueFailure}`
              : clearingFailure,
            [
              ...rescueHashes,
              ...(clearTransactionHash ? [clearTransactionHash] : []),
            ],
          );
        }
      }
    }
    if (rescueError) {
      throw rescueError;
    }

    return this.executionResult({
      signingPackage,
      payerAddress,
      deploymentHashes,
      rescueHashes,
      ...(clearTransactionHash ? { clearTransactionHash } : {}),
      outcomes,
    });
  }

  private executionResult(
    input: {
      signingPackage: Eip7702LocalSigningPackage;
      payerAddress: `0x${string}`;
      deploymentHashes: readonly Hex[];
      rescueHashes: readonly Hex[];
      clearTransactionHash?: Hex;
      outcomes: readonly Eip7702ActionOutcome[];
    },
  ): Eip7702ExecutionResult {
    const {
      signingPackage,
      payerAddress,
      deploymentHashes,
      rescueHashes,
      clearTransactionHash,
      outcomes,
    } = input;
    const completed = outcomes.filter((outcome) => outcome.status === "COMPLETED").length;
    const status = completed === outcomes.length && completed > 0
      ? "COMPLETED"
      : completed > 0
        ? "PARTIAL"
        : "FAILED";
    return {
      packageId: signingPackage.packageId,
      route: signingPackage.route,
      chainId: signingPackage.chainId,
      sourceAddress: getAddress(signingPackage.sourceAddress),
      destinationAddress: getAddress(signingPackage.destinationAddress),
      payerAddress,
      status,
      sourcePaidGas: false,
      deploymentHashes,
      rescueTransactionHashes: rescueHashes,
      ...(clearTransactionHash ? { clearTransactionHash } : {}),
      outcomes,
      completedAt: this.clock().toISOString(),
    };
  }
}

export function clearedEip7702AuthorizationRequest(input: {
  chainId: 196;
  sourceNonce: number;
}): AuthorizationRequest {
  return {
    address: zeroAddress,
    chainId: input.chainId,
    nonce: input.sourceNonce + 1,
  };
}
