import { decodeEventLog, type Hex } from "viem";

import type {
  AgentServiceJob,
  BuyerExecutionReport,
  BuyerExecutionVerifierPort,
  RescueMonitorObservation,
} from "@safeexit/agent-service";
import {
  createDedicatedPublicClient,
  type ChainAdapterConfig,
} from "@safeexit/chain";

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
    logs: Array<{
      address: `0x${string}`;
      data: Hex;
      topics: readonly Hex[];
    }>;
  }>;
}

export class LiveBuyerExecutionVerifier implements BuyerExecutionVerifierPort {
  private readonly client: BuyerReceiptClient;

  constructor(
    private readonly chain: ChainAdapterConfig,
    rpcUrl: string,
    private readonly clock: () => Date = () => new Date(),
    client?: BuyerReceiptClient,
  ) {
    this.client = client ?? createDedicatedPublicClient(chain, rpcUrl);
  }

  async verify(
    job: AgentServiceJob,
    report: BuyerExecutionReport,
  ): Promise<RescueMonitorObservation> {
    if (!job.signingPackage || report.chainId !== this.chain.chain.id) {
      throw new Error("Buyer receipt verification is not configured for this report");
    }
    const signingPackage = job.signingPackage;
    const receipts = await Promise.all(report.transactionHashes.map((hash) =>
      this.client.getTransactionReceipt({ hash: hash as Hex })));
    if (receipts.some((receipt) => receipt.status !== "success")) {
      throw new Error("A reported destination settlement transaction reverted");
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
      throw new Error("Reported receipts do not prove the committed asset transfer");
    }
    return {
      phase: "COMPLETED",
      completedActionIds: [signingPackage.actionId],
      failedActionIds: [],
      transactionHashes: [...report.transactionHashes],
      observedAt: this.clock().toISOString(),
      detail: `Receipt status and committed Transfer event verified by ${this.chain.chain.name} RPC.`,
    };
  }
}
