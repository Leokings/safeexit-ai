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
  encodeFunctionData,
  getAddress,
  http,
  keccak256,
  zeroAddress,
  type AuthorizationRequest,
  type Hex,
  type LocalAccount,
  type SignedAuthorization,
} from "viem";

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

function authorizationParity(
  authorization: SignedAuthorization,
): bigint | undefined {
  if (authorization.yParity !== undefined) {
    return BigInt(authorization.yParity);
  }
  if (authorization.v === undefined) {
    return undefined;
  }
  const value = BigInt(authorization.v);
  return value >= 27n ? value - 27n : value;
}

function sameAuthorization(
  actual: SignedAuthorization,
  expected: SignedAuthorization,
): boolean {
  return (
    actual.address.toLowerCase() === expected.address.toLowerCase() &&
    BigInt(actual.chainId) === BigInt(expected.chainId) &&
    BigInt(actual.nonce) === BigInt(expected.nonce) &&
    authorizationParity(actual) === authorizationParity(expected) &&
    actual.r.toLowerCase() === expected.r.toLowerCase() &&
    actual.s.toLowerCase() === expected.s.toLowerCase()
  );
}

function authorizationListMatches(
  transaction: {
    type?: string | undefined;
    authorizationList?: readonly SignedAuthorization[] | undefined;
  },
  expected: readonly SignedAuthorization[],
): boolean {
  const actual = transaction.authorizationList;
  return (
    transaction.type === "eip7702" &&
    Boolean(actual) &&
    actual!.length === expected.length &&
    actual!.every((authorization, index) =>
      sameAuthorization(authorization, expected[index]!),
    )
  );
}

async function wait(milliseconds: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, milliseconds);
  });
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

export class ViemLocalEip7702DestinationTransport
implements Eip7702DestinationTransportPort {
  private readonly publicClient: ReturnType<typeof createDedicatedPublicClient>;
  private readonly walletClient: ReturnType<typeof createWalletClient>;
  private readonly submittedAuthorizations = new Map<
    Hex,
    readonly SignedAuthorization[]
  >();

  constructor(
    private readonly chain: ChainAdapterConfig,
    rpcUrl: string,
    private readonly account: LocalAccount,
    private readonly clock: () => Date = () => new Date(),
  ) {
    if (chain.chain.id !== 196) {
      throw new Error("The local EIP-7702 transport is enabled only for X Layer");
    }
    const url = new URL(rpcUrl);
    if (url.protocol !== "https:") {
      throw new Error("The production EIP-7702 transport requires an HTTPS RPC URL");
    }
    this.publicClient = createDedicatedPublicClient(chain, url.toString());
    this.walletClient = createWalletClient({
      account,
      chain: chain.chain,
      transport: http(url.toString(), { retryCount: 2, timeout: 10_000 }),
    });
  }

  async getAddress(): Promise<`0x${string}`> {
    return getAddress(this.account.address);
  }

  async getChainId(): Promise<number> {
    return this.chain.chain.id;
  }

  async inspect(
    signingPackage: Eip7702LocalSigningPackage,
  ): Promise<Eip7702PackageInspection> {
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
    return this.walletClient.sendTransaction({
      account: this.account,
      chain: this.chain.chain,
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
    if (request.authorizationList) {
      const hash = await this.walletClient.sendTransaction({
        account: this.account,
        chain: this.chain.chain,
        type: "eip7702",
        to: getAddress(request.to),
        value: request.value,
        data: request.data,
        authorizationList: request.authorizationList,
      });
      this.submittedAuthorizations.set(hash, [...request.authorizationList]);
      return hash;
    }
    return this.walletClient.sendTransaction({
      account: this.account,
      chain: this.chain.chain,
      to: getAddress(request.to),
      value: request.value,
      data: request.data,
    });
  }

  async waitForReceipt(hash: Hex): Promise<DestinationReceipt> {
    const policy = getRescueFinalityPolicy(this.chain.chain.id);
    const requiredConfirmationOffset = BigInt(
      Math.max(1, policy.minimumConfirmations) - 1,
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
        `The transaction did not reach ${policy.minimumConfirmations} canonical ` +
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
          if (authorizationListMatches(transaction, expectedAuthorizations)) {
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
    if (confirmations < BigInt(policy.minimumConfirmations)) {
      throw new Eip7702RuntimeError(
        "SUBMISSION_FAILED",
        `The EIP-7702 transaction has fewer than ${policy.minimumConfirmations} confirmations`,
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
}
