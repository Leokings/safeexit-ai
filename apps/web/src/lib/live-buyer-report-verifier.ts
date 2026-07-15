import {
  TransactionReceiptNotFoundError,
  decodeEventLog,
  type Address,
  type Hex,
} from "viem";

import type {
  AgentServiceJob,
  BuyerExecutionReport,
  BuyerExecutionVerifierPort,
  RescueMonitorObservation,
} from "@safeexit/agent-service";
import {
  BuyerReceiptPendingError,
  BuyerReceiptRejectedError,
  BuyerReceiptRevertedError,
} from "@safeexit/agent-service";
import {
  createDedicatedPublicClient,
  type ChainAdapterConfig,
} from "@safeexit/chain";
import { assertReceiptSubmissionTransaction } from "./buyer-receipt-registration";

const erc20TransferAbi = [{
  type: "event",
  name: "Transfer",
  inputs: [
    { name: "from", type: "address", indexed: true },
    { name: "to", type: "address", indexed: true },
    { name: "value", type: "uint256", indexed: false },
  ],
}] as const;

const erc721TransferAbi = [{
  type: "event",
  name: "Transfer",
  inputs: [
    { name: "from", type: "address", indexed: true },
    { name: "to", type: "address", indexed: true },
    { name: "tokenId", type: "uint256", indexed: true },
  ],
}] as const;

function sameAddress(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

export interface BuyerReceiptClient {
  getTransactionReceipt(input: { hash: Hex }): Promise<{
    status: "success" | "reverted";
    blockNumber: bigint;
    logs: Array<{
      address: `0x${string}`;
      data: Hex;
      topics: readonly Hex[];
    }>;
  }>;
  getTransaction(input: { hash: Hex }): Promise<{
    from: Address;
    to: Address | null;
    value: bigint;
    input: Hex;
  }>;
  getErc20Balance(input: {
    token: Address;
    owner: Address;
    blockNumber: bigint;
  }): Promise<bigint>;
  getErc721Owner(input: {
    collection: Address;
    tokenId: bigint;
    blockNumber: bigint;
  }): Promise<Address>;
}

const erc20BalanceAbi = [{
  type: "function",
  name: "balanceOf",
  stateMutability: "view",
  inputs: [{ name: "account", type: "address" }],
  outputs: [{ name: "", type: "uint256" }],
}] as const;

const erc721OwnerAbi = [{
  type: "function",
  name: "ownerOf",
  stateMutability: "view",
  inputs: [{ name: "tokenId", type: "uint256" }],
  outputs: [{ name: "", type: "address" }],
}] as const;

export class LiveBuyerExecutionVerifier implements BuyerExecutionVerifierPort {
  private readonly client: BuyerReceiptClient;

  constructor(
    private readonly chain: ChainAdapterConfig,
    rpcUrl: string,
    private readonly clock: () => Date = () => new Date(),
    client?: BuyerReceiptClient,
  ) {
    if (client) {
      this.client = client;
      return;
    }
    const publicClient = createDedicatedPublicClient(chain, rpcUrl);
    this.client = {
      getTransactionReceipt: (input) => publicClient.getTransactionReceipt(input),
      getTransaction: (input) => publicClient.getTransaction(input),
      getErc20Balance: (input) => publicClient.readContract({
        address: input.token,
        abi: erc20BalanceAbi,
        functionName: "balanceOf",
        args: [input.owner],
        blockNumber: input.blockNumber,
      }),
      getErc721Owner: (input) => publicClient.readContract({
        address: input.collection,
        abi: erc721OwnerAbi,
        functionName: "ownerOf",
        args: [input.tokenId],
        blockNumber: input.blockNumber,
      }),
    };
  }

  async verify(
    job: AgentServiceJob,
    report: BuyerExecutionReport,
  ): Promise<RescueMonitorObservation> {
    const signingPackage = (job.signingPackages ?? (job.signingPackage ? [job.signingPackage] : []))
      .find((candidate) => candidate.packageId === report.packageId);
    if (!signingPackage || report.chainId !== this.chain.chain.id) {
      throw new Error("Buyer receipt verification is not configured for this report");
    }
    if (report.transactionHashes.length !== 1) {
      throw new BuyerReceiptRejectedError();
    }
    let receipts: Awaited<ReturnType<BuyerReceiptClient["getTransactionReceipt"]>>[];
    let transactions: Awaited<ReturnType<BuyerReceiptClient["getTransaction"]>>[];
    try {
      [receipts, transactions] = await Promise.all([
        Promise.all(report.transactionHashes.map((hash) =>
          this.client.getTransactionReceipt({ hash: hash as Hex }))),
        Promise.all(report.transactionHashes.map((hash) =>
          this.client.getTransaction({ hash: hash as Hex }))),
      ]);
    } catch (error) {
      if (
        error instanceof TransactionReceiptNotFoundError ||
        (error instanceof Error && error.name === "TransactionReceiptNotFoundError")
      ) {
        throw new BuyerReceiptPendingError();
      }
      throw error;
    }
    if (receipts.some((receipt) => receipt.status !== "success")) {
      throw new BuyerReceiptRevertedError();
    }

    try {
      await assertReceiptSubmissionTransaction(signingPackage, transactions[0]!);
    } catch {
      throw new BuyerReceiptRejectedError();
    }

    const matchedTransfer = receipts.some((receipt) => receipt.logs.some((log) => {
      if (signingPackage.route === "ERC4494_PERMIT_SETTLEMENT") {
        if (!sameAddress(log.address, signingPackage.collectionAddress)) return false;
        try {
          const decoded = decodeEventLog({
            abi: erc721TransferAbi,
            data: log.data,
            topics: [...log.topics] as [Hex, ...Hex[]],
          });
          return decoded.eventName === "Transfer" &&
            sameAddress(decoded.args.from, signingPackage.sourceAddress) &&
            sameAddress(decoded.args.to, signingPackage.destinationAddress) &&
            decoded.args.tokenId === BigInt(signingPackage.tokenId);
        } catch {
          return false;
        }
      }
      if (!sameAddress(log.address, signingPackage.tokenAddress)) return false;
      try {
        const decoded = decodeEventLog({
          abi: erc20TransferAbi,
          data: log.data,
          topics: [...log.topics] as [Hex, ...Hex[]],
        });
        return decoded.eventName === "Transfer" &&
          sameAddress(decoded.args.from, signingPackage.sourceAddress) &&
          sameAddress(decoded.args.to, signingPackage.destinationAddress) &&
          decoded.args.value === BigInt(signingPackage.amount);
      } catch {
        return false;
      }
    }));
    if (!matchedTransfer) {
      throw new BuyerReceiptRejectedError();
    }
    const receiptBlock = receipts[0]!.blockNumber;
    if (signingPackage.route === "ERC4494_PERMIT_SETTLEMENT") {
      const owner = await this.client.getErc721Owner({
        collection: signingPackage.collectionAddress as Address,
        tokenId: BigInt(signingPackage.tokenId),
        blockNumber: receiptBlock,
      });
      if (!sameAddress(owner, signingPackage.destinationAddress)) {
        throw new BuyerReceiptRejectedError();
      }
    } else {
      const balance = await this.client.getErc20Balance({
        token: signingPackage.tokenAddress as Address,
        owner: signingPackage.destinationAddress as Address,
        blockNumber: receiptBlock,
      });
      if (balance < BigInt(signingPackage.amount)) {
        throw new BuyerReceiptRejectedError();
      }
    }
    return {
      phase: "COMPLETED",
      completedActionIds: [signingPackage.actionId],
      failedActionIds: [],
      transactionHashes: [...report.transactionHashes],
      observedAt: this.clock().toISOString(),
      detail: `Receipt calldata, source authorization, Transfer event, and final asset state verified by ${this.chain.chain.name} RPC.`,
    };
  }
}
