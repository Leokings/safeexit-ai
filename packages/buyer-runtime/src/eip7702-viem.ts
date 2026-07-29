import {
  eip7702RescueDelegateAbi,
  eip7702RescueDelegateFactoryAbi,
} from "@safeexit/adapters/eip7702-rescue";
import type { Eip7702LocalSigningPackage } from "@safeexit/agent-service/eip7702-signing-package";
import {
  createDedicatedPublicClient,
  getRescueFinalityPolicy,
  type ChainAdapterConfig,
} from "@safeexit/chain/config";
import {
  createWalletClient,
  custom,
  encodeFunctionData,
  getAddress,
  http,
  keccak256,
  zeroAddress,
  type Address,
  type AuthorizationRequest,
  type EIP1193Provider,
  type Hex,
  type LocalAccount,
  type SignedAuthorization,
} from "viem";
import { recoverAuthorizationAddress } from "viem/utils";

import {
  Eip7702RuntimeError,
  type Eip7702DestinationTransportPort,
  type Eip7702LocalSimulation,
  type Eip7702LocalTransactionRequest,
  type Eip7702PackageInspection,
  type Eip7702SourceAuthorizationSignerPort,
} from "./eip7702-runtime";
import {
  destinationReceiptSchema,
  type DestinationReceipt,
} from "./schemas";

const zeroHash = `0x${"00".repeat(32)}` as const;
const AUTHORIZATION_READ_ATTEMPTS = 5;
const AUTHORIZATION_READ_DELAY_MS = 1_000;
const RECEIPT_POLL_INTERVAL_MS = 1_000;
const RECEIPT_TIMEOUT_MS = 10 * 60 * 1_000;

function safeMessage(error: unknown): string {
  return (error instanceof Error ? error.message : "Local RPC request failed").slice(0, 1_000);
}

function asHex(value: string): Hex {
  return value as Hex;
}

function sameAuthorizationScope(
  actual: SignedAuthorization,
  expected: SignedAuthorization,
): boolean {
  return (
    actual.address.toLowerCase() === expected.address.toLowerCase() &&
    BigInt(actual.chainId) === BigInt(expected.chainId) &&
    BigInt(actual.nonce) === BigInt(expected.nonce)
  );
}

async function authorizationListMatches(
  transaction: {
    type?: string | undefined;
    authorizationList?: readonly SignedAuthorization[] | undefined;
  },
  expected: readonly SignedAuthorization[],
): Promise<boolean> {
  const actual = transaction.authorizationList;
  if (
    transaction.type !== "eip7702" ||
    !actual ||
    actual.length !== expected.length
  ) {
    return false;
  }

  for (const [index, authorization] of actual.entries()) {
    const expectedAuthorization = expected[index]!;
    if (!sameAuthorizationScope(authorization, expectedAuthorization)) {
      return false;
    }
    try {
      const [actualSigner, expectedSigner] = await Promise.all([
        recoverAuthorizationAddress({ authorization }),
        recoverAuthorizationAddress({ authorization: expectedAuthorization }),
      ]);
      if (actualSigner.toLowerCase() !== expectedSigner.toLowerCase()) {
        return false;
      }
    } catch {
      return false;
    }
  }

  return true;
}

async function wait(milliseconds: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

export type Eip1193DestinationProvider = Pick<EIP1193Provider, "request">;

type DestinationTransactionRequest = {
  to: Address;
  value: bigint;
  data: Hex;
  authorizationList?: readonly SignedAuthorization[];
};

type DestinationTransactionSender = (
  request: DestinationTransactionRequest,
) => Promise<Hex>;

function validatedProductionRpcUrl(rpcUrl: string): string {
  const url = new URL(rpcUrl);
  if (url.protocol !== "https:") {
    throw new Error("The production EIP-7702 transport requires an HTTPS RPC URL");
  }
  return url.toString();
}

function createLocalDestinationSender(
  chain: ChainAdapterConfig,
  rpcUrl: string,
  account: LocalAccount,
): DestinationTransactionSender {
  const walletClient = createWalletClient({
    account,
    chain: chain.chain,
    transport: http(validatedProductionRpcUrl(rpcUrl), {
      retryCount: 2,
      timeout: 10_000,
    }),
  });
  return async (request) => {
    if (request.authorizationList) {
      return walletClient.sendTransaction({
        account,
        chain: chain.chain,
        type: "eip7702",
        to: request.to,
        value: request.value,
        data: request.data,
        authorizationList: request.authorizationList,
      });
    }
    return walletClient.sendTransaction({
      account,
      chain: chain.chain,
      to: request.to,
      value: request.value,
      data: request.data,
    });
  };
}

async function assertInjectedDestination(
  provider: Eip1193DestinationProvider,
  expectedAddress: Address,
  expectedChainId: number,
): Promise<void> {
  const [chainIdValue, accountValues] = await Promise.all([
    provider.request({ method: "eth_chainId" }),
    provider.request({ method: "eth_accounts" }),
  ]);
  const chainId =
    typeof chainIdValue === "string" && /^0x[0-9a-f]+$/i.test(chainIdValue)
      ? Number(BigInt(chainIdValue))
      : Number.NaN;
  if (chainId !== expectedChainId) {
    throw new Eip7702RuntimeError(
      "CHAIN_MISMATCH",
      `The connected destination wallet must use chain ${expectedChainId}`,
    );
  }
  const activeAddress =
    Array.isArray(accountValues) && typeof accountValues[0] === "string"
      ? getAddress(accountValues[0])
      : undefined;
  if (!activeAddress || activeAddress.toLowerCase() !== expectedAddress.toLowerCase()) {
    throw new Eip7702RuntimeError(
      "DESTINATION_MISMATCH",
      "The active wallet account is not the reviewed safe destination",
    );
  }
}

function createInjectedDestinationSender(
  chain: ChainAdapterConfig,
  provider: Eip1193DestinationProvider,
  expectedAddress: Address,
): DestinationTransactionSender {
  const walletClient = createWalletClient({
    account: expectedAddress,
    chain: chain.chain,
    transport: custom(provider as EIP1193Provider),
  });
  return async (request) => {
    await assertInjectedDestination(
      provider,
      expectedAddress,
      chain.chain.id,
    );
    if (request.authorizationList) {
      return walletClient.sendTransaction({
        account: expectedAddress,
        chain: chain.chain,
        type: "eip7702",
        to: request.to,
        value: request.value,
        data: request.data,
        authorizationList: request.authorizationList,
      });
    }
    return walletClient.sendTransaction({
      account: expectedAddress,
      chain: chain.chain,
      to: request.to,
      value: request.value,
      data: request.data,
    });
  };
}

/**
 * Wraps a signer that already exists in the buyer's local process. SafeExit
 * never accepts the account, its private key, or its resulting authorizations
 * over an API boundary.
 */
export class ViemLocalEip7702SourceSigner
implements Eip7702SourceAuthorizationSignerPort {
  private readonly sign: NonNullable<LocalAccount["signAuthorization"]>;

  constructor(private readonly account: LocalAccount) {
    if (!account.signAuthorization) {
      throw new Error("The local source account cannot sign EIP-7702 authorizations");
    }
    this.sign = account.signAuthorization;
  }

  async getAddress(): Promise<`0x${string}`> {
    return getAddress(this.account.address);
  }

  async signAuthorization(
    request: AuthorizationRequest,
  ): Promise<SignedAuthorization> {
    return this.sign(request);
  }
}

abstract class ViemEip7702DestinationTransport
implements Eip7702DestinationTransportPort {
  private readonly publicClient: ReturnType<typeof createDedicatedPublicClient>;
  private readonly submittedAuthorizations = new Map<
    Hex,
    readonly SignedAuthorization[]
  >();

  constructor(
    private readonly chain: ChainAdapterConfig,
    rpcUrl: string,
    private readonly payerAddress: Address,
    private readonly sendDestinationTransaction: DestinationTransactionSender,
    private readonly clock: () => Date = () => new Date(),
  ) {
    if (chain.chain.id !== 196) {
      throw new Error("The EIP-7702 destination transport is enabled only for X Layer");
    }
    this.publicClient = createDedicatedPublicClient(
      chain,
      validatedProductionRpcUrl(rpcUrl),
    );
  }

  async getAddress(): Promise<`0x${string}`> {
    return this.payerAddress;
  }

  async getChainId(): Promise<number> {
    return this.chain.chain.id;
  }

  private assertPackageScope(
    signingPackage: Eip7702LocalSigningPackage,
  ): void {
    if (
      signingPackage.chainId !== this.chain.chain.id
    ) {
      throw new Eip7702RuntimeError(
        "CHAIN_MISMATCH",
        "The EIP-7702 package does not match this gas-payer transport",
      );
    }
  }

  private assertTransactionScope(
    request: Eip7702LocalTransactionRequest,
  ): void {
    if (request.chainId !== this.chain.chain.id) {
      throw new Eip7702RuntimeError(
        "CHAIN_MISMATCH",
        "The EIP-7702 request does not match the destination chain",
      );
    }
    if (request.from.toLowerCase() !== this.payerAddress.toLowerCase()) {
      throw new Eip7702RuntimeError(
        "DESTINATION_MISMATCH",
        "The EIP-7702 request payer is not the active local gas account",
      );
    }
    if (request.value !== 0n) {
      throw new Eip7702RuntimeError(
        "SUBMISSION_FAILED",
        "SafeExit EIP-7702 requests cannot transfer destination wallet value",
      );
    }
  }

  async inspect(
    signingPackage: Eip7702LocalSigningPackage,
  ): Promise<Eip7702PackageInspection> {
    this.assertPackageScope(signingPackage);
    const sourceAddress = getAddress(signingPackage.sourceAddress);
    const factoryAddress = getAddress(signingPackage.factoryAddress);
    const delegateAddress = getAddress(signingPackage.delegateAddress);
    const [sourceNonce, sourceCodeValue, factoryCodeValue] = await Promise.all([
      this.publicClient.getTransactionCount({
        address: sourceAddress,
        blockTag: "pending",
      }),
      this.publicClient.getCode({ address: sourceAddress }),
      this.publicClient.getCode({ address: factoryAddress }),
    ]);
    const sourceCode = sourceCodeValue ?? "0x";
    const factoryCode = factoryCodeValue ?? "0x";
    let predictedDelegateAddress: `0x${string}` = zeroAddress;
    if (factoryCode !== "0x") {
      predictedDelegateAddress = await this.publicClient.readContract({
        address: factoryAddress,
        abi: eip7702RescueDelegateFactoryAbi,
        functionName: "predictDelegate",
        args: [
          sourceAddress,
          getAddress(signingPackage.destinationAddress),
          BigInt(signingPackage.deadline),
          asHex(signingPackage.delegatePlanHash),
          asHex(signingPackage.rescueNonce),
        ],
      });
    }

    const delegateCode = await this.publicClient.getCode({
      address: delegateAddress,
    });
    let delegateState: Eip7702PackageInspection["delegateState"];
    if (delegateCode && delegateCode !== "0x") {
      const [chainId, source, destination, deadline, planHash, rescueNonce] =
        await Promise.all([
          this.publicClient.readContract({
            address: delegateAddress,
            abi: eip7702RescueDelegateAbi,
            functionName: "CHAIN_ID",
          }),
          this.publicClient.readContract({
            address: delegateAddress,
            abi: eip7702RescueDelegateAbi,
            functionName: "SOURCE",
          }),
          this.publicClient.readContract({
            address: delegateAddress,
            abi: eip7702RescueDelegateAbi,
            functionName: "DESTINATION",
          }),
          this.publicClient.readContract({
            address: delegateAddress,
            abi: eip7702RescueDelegateAbi,
            functionName: "DEADLINE",
          }),
          this.publicClient.readContract({
            address: delegateAddress,
            abi: eip7702RescueDelegateAbi,
            functionName: "PLAN_HASH",
          }),
          this.publicClient.readContract({
            address: delegateAddress,
            abi: eip7702RescueDelegateAbi,
            functionName: "RESCUE_NONCE",
          }),
        ]);
      delegateState = {
        chainId: Number(chainId),
        sourceAddress: getAddress(source),
        destinationAddress: getAddress(destination),
        deadline: Number(deadline),
        planHash,
        rescueNonce,
      };
    }

    return {
      sourceNonce,
      sourceCode,
      factoryRuntimeHash: factoryCode === "0x" ? zeroHash : keccak256(factoryCode),
      predictedDelegateAddress,
      ...(delegateState ? { delegateState } : {}),
    };
  }

  async deployDelegate(
    signingPackage: Eip7702LocalSigningPackage,
  ): Promise<Hex> {
    this.assertPackageScope(signingPackage);
    return this.sendDestinationTransaction({
      to: getAddress(signingPackage.factoryAddress),
      value: 0n,
      data: encodeFunctionData({
        abi: eip7702RescueDelegateFactoryAbi,
        functionName: "deployDelegate",
        args: [
          getAddress(signingPackage.sourceAddress),
          getAddress(signingPackage.destinationAddress),
          BigInt(signingPackage.deadline),
          asHex(signingPackage.delegatePlanHash),
          asHex(signingPackage.rescueNonce),
        ],
      }),
    });
  }

  async simulate(
    request: Eip7702LocalTransactionRequest,
  ): Promise<Eip7702LocalSimulation> {
    this.assertTransactionScope(request);
    const simulatedAt = this.clock().toISOString();
    try {
      await this.publicClient.call({
        account: getAddress(request.from),
        to: getAddress(request.to),
        value: request.value,
        data: request.data,
        ...(request.authorizationList
          ? { authorizationList: request.authorizationList }
          : {}),
      });
      return {
        status: "SUCCEEDED",
        providerId: `rpc:${this.chain.id}:eth_call`,
        simulatedAt,
      };
    } catch (error) {
      return {
        status: "FAILED",
        providerId: `rpc:${this.chain.id}:eth_call`,
        simulatedAt,
        failureReason: safeMessage(error),
      };
    }
  }

  async submit(request: Eip7702LocalTransactionRequest): Promise<Hex> {
    this.assertTransactionScope(request);
    if (request.authorizationList) {
      const hash = await this.sendDestinationTransaction({
        to: getAddress(request.to),
        value: request.value,
        data: request.data,
        authorizationList: request.authorizationList,
      });
      this.submittedAuthorizations.set(hash, [...request.authorizationList]);
      return hash;
    }
    return this.sendDestinationTransaction({
      to: getAddress(request.to),
      value: request.value,
      data: request.data,
    });
  }

  private async waitForCanonicalReceipt(
    hash: Hex,
    minimumConfirmations: number,
  ): Promise<DestinationReceipt> {
    const requiredConfirmationOffset = BigInt(
      Math.max(1, minimumConfirmations) - 1,
    );
    const deadline = Date.now() + RECEIPT_TIMEOUT_MS;
    let receipt:
      | Awaited<ReturnType<typeof this.publicClient.getTransactionReceipt>>
      | undefined;
    let latestBlock = 0n;
    let lastObservation = "transaction receipt is not available";

    while (Date.now() <= deadline) {
      try {
        const candidate = await this.publicClient.getTransactionReceipt({ hash });
        const observedLatestBlock = await this.publicClient.getBlockNumber({
          cacheTime: 0,
        });
        receipt = candidate;
        latestBlock = observedLatestBlock;
        const requiredBlock =
          candidate.blockNumber + requiredConfirmationOffset;
        if (observedLatestBlock >= requiredBlock) {
          break;
        }
        lastObservation =
          `receipt block ${candidate.blockNumber} has latest block ` +
          `${observedLatestBlock}`;
      } catch (error) {
        lastObservation = safeMessage(error);
      }
      if (Date.now() >= deadline) {
        break;
      }
      await wait(RECEIPT_POLL_INTERVAL_MS);
    }

    if (
      !receipt ||
      latestBlock < receipt.blockNumber + requiredConfirmationOffset
    ) {
      throw new Eip7702RuntimeError(
        "SUBMISSION_FAILED",
        `The transaction did not reach ${minimumConfirmations} canonical ` +
          `confirmations before timeout (${lastObservation})`,
        [hash],
      );
    }
    const expectedAuthorizations = this.submittedAuthorizations.get(hash);
    const [canonicalBlock, refreshedReceipt] = await Promise.all([
      this.publicClient.getBlock({ blockNumber: receipt.blockNumber }),
      this.publicClient.getTransactionReceipt({ hash }),
    ]);
    if (
      canonicalBlock.hash.toLowerCase() !== receipt.blockHash.toLowerCase() ||
      refreshedReceipt.blockHash.toLowerCase() !== receipt.blockHash.toLowerCase() ||
      refreshedReceipt.blockNumber !== receipt.blockNumber
    ) {
      throw new Eip7702RuntimeError(
        "SUBMISSION_FAILED",
        "The EIP-7702 receipt block is no longer canonical",
        [hash],
      );
    }
    if (expectedAuthorizations) {
      let preserved = false;
      let lastObservation = "transaction data was unavailable";
      for (let attempt = 1; attempt <= AUTHORIZATION_READ_ATTEMPTS; attempt += 1) {
        try {
          const transaction = await this.publicClient.getTransaction({ hash });
          if (await authorizationListMatches(transaction, expectedAuthorizations)) {
            preserved = true;
            break;
          }
          lastObservation =
            `type=${transaction.type}; authorizationCount=` +
            `${transaction.authorizationList?.length ?? 0}`;
        } catch (error) {
          lastObservation = safeMessage(error);
        }
        if (attempt < AUTHORIZATION_READ_ATTEMPTS) {
          await wait(AUTHORIZATION_READ_DELAY_MS);
        }
      }
      if (!preserved) {
        throw new Eip7702RuntimeError(
          "SUBMISSION_FAILED",
          "The submitted transaction did not preserve the signed EIP-7702 " +
            `authorization list after ${AUTHORIZATION_READ_ATTEMPTS} observations ` +
            `(${lastObservation})`,
          [hash],
        );
      }
      this.submittedAuthorizations.delete(hash);
    }
    const confirmations = latestBlock >= receipt.blockNumber
      ? latestBlock - receipt.blockNumber + 1n
      : 0n;
    if (confirmations < BigInt(minimumConfirmations)) {
      throw new Eip7702RuntimeError(
        "SUBMISSION_FAILED",
        `The EIP-7702 transaction has fewer than ${minimumConfirmations} confirmations`,
        [hash],
      );
    }
    return destinationReceiptSchema.parse({
      status: receipt.status === "success" ? "CONFIRMED" : "FAILED",
      transactionHashes: [hash],
      blockNumber: receipt.blockNumber.toString(),
      blockHash: receipt.blockHash,
      confirmations: confirmations > BigInt(Number.MAX_SAFE_INTEGER)
        ? Number.MAX_SAFE_INTEGER
        : Number(confirmations),
      canonical: true,
      observedAt: this.clock().toISOString(),
      ...(receipt.status === "success"
        ? {}
        : { failureReason: "EIP-7702 destination-paid transaction reverted" }),
    });
  }

  async waitForInclusion(hash: Hex): Promise<DestinationReceipt> {
    return this.waitForCanonicalReceipt(hash, 1);
  }

  async waitForReceipt(hash: Hex): Promise<DestinationReceipt> {
    const policy = getRescueFinalityPolicy(this.chain.chain.id);
    return this.waitForCanonicalReceipt(hash, policy.minimumConfirmations);
  }
}

export class ViemLocalEip7702DestinationTransport
extends ViemEip7702DestinationTransport {
  constructor(
    chain: ChainAdapterConfig,
    rpcUrl: string,
    account: LocalAccount,
    clock: () => Date = () => new Date(),
  ) {
    super(
      chain,
      rpcUrl,
      getAddress(account.address),
      createLocalDestinationSender(chain, rpcUrl, account),
      clock,
    );
  }
}

export class ViemInjectedEip7702DestinationTransport
extends ViemEip7702DestinationTransport {
  constructor(
    chain: ChainAdapterConfig,
    rpcUrl: string,
    provider: Eip1193DestinationProvider,
    expectedDestinationAddress: `0x${string}`,
    clock: () => Date = () => new Date(),
  ) {
    const destinationAddress = getAddress(expectedDestinationAddress);
    super(
      chain,
      rpcUrl,
      destinationAddress,
      createInjectedDestinationSender(chain, provider, destinationAddress),
      clock,
    );
  }
}
