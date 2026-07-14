import { getAddress, isAddress, type Hex } from "viem";

import type {
  AtomicSettlementSimulatorPort,
  DestinationSettlementWalletPort,
  LocalSourceSignerPort,
  SettlementBatch,
  SourceSigningRequest,
} from "./ports";
import {
  destinationReceiptSchema,
  destinationSubmissionSchema,
  settlementSimulationSchema,
  type DestinationReceipt,
  type DestinationSubmission,
  type SettlementSimulation,
} from "./schemas";

export interface Eip1193Provider {
  request(request: { method: string; params?: readonly unknown[] }): Promise<unknown>;
}

function messageFor(error: unknown): string {
  return (error instanceof Error ? error.message : "Provider request failed").slice(0, 1_000);
}

function parseAccount(value: unknown): `0x${string}` {
  if (!Array.isArray(value) || typeof value[0] !== "string" || !isAddress(value[0])) {
    throw new Error("Wallet did not return a valid EVM account");
  }
  return getAddress(value[0]);
}

function parseHash(value: unknown): Hex {
  if (typeof value !== "string" || !/^0x[a-fA-F0-9]{64}$/.test(value)) {
    throw new Error("Wallet did not return a valid transaction hash");
  }
  return value as Hex;
}

export class Eip1193LocalSourceSigner implements LocalSourceSignerPort {
  constructor(private readonly provider: Eip1193Provider) {}

  async getAddress(): Promise<`0x${string}`> {
    return parseAccount(await this.provider.request({ method: "eth_requestAccounts" }));
  }

  async signTypedData(request: SourceSigningRequest): Promise<Hex> {
    const address = await this.getAddress();
    const result = await this.provider.request({
      method: request.rpcMethod,
      params: [address, JSON.stringify(request.typedData)],
    });
    if (typeof result !== "string" || !/^0x[a-fA-F0-9]{130}$/.test(result)) {
      throw new Error("Wallet did not return a valid EIP-712 signature");
    }
    return result as Hex;
  }
}

type Eip1193DestinationWalletOptions = {
  pollIntervalMs?: number;
  maximumPolls?: number;
  clock?: () => Date;
  sleep?: (milliseconds: number) => Promise<void>;
};

export class Eip1193DestinationWallet implements DestinationSettlementWalletPort {
  private readonly pollIntervalMs: number;
  private readonly maximumPolls: number;
  private readonly clock: () => Date;
  private readonly sleep: (milliseconds: number) => Promise<void>;

  constructor(
    private readonly provider: Eip1193Provider,
    options: Eip1193DestinationWalletOptions = {},
  ) {
    this.pollIntervalMs = options.pollIntervalMs ?? 2_000;
    this.maximumPolls = options.maximumPolls ?? 60;
    this.clock = options.clock ?? (() => new Date());
    this.sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => {
      setTimeout(resolve, milliseconds);
    }));
  }

  async getAddress(): Promise<`0x${string}`> {
    return parseAccount(await this.provider.request({ method: "eth_requestAccounts" }));
  }

  async getChainId(): Promise<number> {
    const value = await this.provider.request({ method: "eth_chainId" });
    if (typeof value !== "string" || !/^0x[0-9a-fA-F]+$/.test(value)) {
      throw new Error("Wallet did not return a valid EVM chain ID");
    }
    const chainId = Number(BigInt(value));
    if (!Number.isSafeInteger(chainId) || chainId <= 0) {
      throw new Error("Wallet chain ID is outside the supported range");
    }
    return chainId;
  }

  async supportsAtomicBatch(): Promise<boolean> {
    return false;
  }

  async submit(batch: SettlementBatch): Promise<DestinationSubmission> {
    if (batch.atomicRequired || batch.calls.length !== 1) {
      throw new Error("SafeExit destination settlement requires one non-batched contract call");
    }
    const onlyCall = batch.calls[0];
    if (!onlyCall) throw new Error("Settlement batch is empty");
    const hash = parseHash(await this.provider.request({
      method: "eth_sendTransaction",
      params: [{ from: batch.from, ...onlyCall }],
    }));
    return destinationSubmissionSchema.parse({ submissionId: `tx:${hash}` });
  }

  async waitForReceipt(submission: DestinationSubmission): Promise<DestinationReceipt> {
    const parsed = destinationSubmissionSchema.parse(submission);
    if (parsed.submissionId.startsWith("tx:")) {
      const hash = parseHash(parsed.submissionId.slice(3));
      for (let attempt = 0; attempt < this.maximumPolls; attempt += 1) {
        const result = await this.provider.request({
          method: "eth_getTransactionReceipt",
          params: [hash],
        });
        if (result && typeof result === "object" && "status" in result) {
          return destinationReceiptSchema.parse({
            status: result.status === "0x1" ? "CONFIRMED" : "FAILED",
            transactionHashes: [hash],
            observedAt: this.clock().toISOString(),
            ...(result.status === "0x1" ? {} : { failureReason: "Transaction reverted" }),
          });
        }
        await this.sleep(this.pollIntervalMs);
      }
      throw new Error("Transaction did not confirm before the local timeout");
    }

    throw new Error("Unsupported destination submission identifier");
  }
}

export class EthSimulateV1AtomicSimulator implements AtomicSettlementSimulatorPort {
  constructor(
    private readonly provider: Eip1193Provider,
    private readonly providerId: string,
    private readonly clock: () => Date = () => new Date(),
    private readonly blockTag: string = "latest",
  ) {}

  async simulate(batch: SettlementBatch): Promise<SettlementSimulation> {
    const simulatedAt = this.clock().toISOString();
    try {
      const result = await this.provider.request({
        method: "eth_simulateV1",
        params: [{
          blockStateCalls: [{
            calls: batch.calls.map((settlementCall) => ({
              from: batch.from,
              ...settlementCall,
            })),
          }],
          validation: true,
          traceTransfers: true,
        }, this.blockTag],
      });
      const block = Array.isArray(result) ? result[0] : undefined;
      const calls = block && typeof block === "object" && "calls" in block && Array.isArray(block.calls)
        ? block.calls
        : undefined;
      if (!calls || calls.length !== batch.calls.length) {
        throw new Error("eth_simulateV1 returned an incomplete call sequence");
      }
      const failed = calls.find(
        (item: unknown) => !item || typeof item !== "object" || !("status" in item) || item.status !== "0x1",
      );
      if (failed) {
        const reason = typeof failed === "object" && failed && "error" in failed &&
          failed.error && typeof failed.error === "object" && "message" in failed.error &&
          typeof failed.error.message === "string"
          ? failed.error.message
          : "A settlement call reverted";
        return settlementSimulationSchema.parse({
          status: "FAILED",
          providerId: this.providerId,
          simulatedAt,
          callCount: calls.length,
          failureReason: reason,
        });
      }
      return settlementSimulationSchema.parse({
        status: "SUCCEEDED",
        providerId: this.providerId,
        simulatedAt,
        callCount: calls.length,
      });
    } catch (error) {
      return settlementSimulationSchema.parse({
        status: "FAILED",
        providerId: this.providerId,
        simulatedAt,
        callCount: batch.calls.length,
        failureReason: messageFor(error),
      });
    }
  }
}
