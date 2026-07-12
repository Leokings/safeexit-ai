import type { EvmAddress } from "@safeexit/shared";

export * from "./config";

export type CapabilitySupport = "VERIFIED" | "UNSUPPORTED" | "UNKNOWN";

export type ChainCapabilities = {
  chainId: number;
  nativeSymbol: string;
  rpcRead: boolean;
  rpcTrace: boolean;
  stateOverride: boolean;
  eip1559: boolean;
  eip7702: CapabilitySupport;
  privateSubmission: CapabilitySupport;
  sponsoredExecution: CapabilitySupport;
  simulationProviders: readonly string[];
};

export interface ChainReader {
  readonly capabilities: ChainCapabilities;
  getBlockNumber(): Promise<bigint>;
  getBalance(address: EvmAddress, blockNumber?: bigint): Promise<bigint>;
  getTransactionCount(address: EvmAddress, pending?: boolean): Promise<bigint>;
}
