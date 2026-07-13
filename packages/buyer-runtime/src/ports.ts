import type { SigningPackage } from "@safeexit/agent-service";
import type { Hex } from "viem";

import type {
  DestinationReceipt,
  DestinationSubmission,
  SettlementCall,
  SettlementSimulation,
} from "./schemas";

export type SourceSigningRequest = SigningPackage["sourceSigningRequests"][number];

export interface LocalSourceSignerPort {
  getAddress(): Promise<`0x${string}`>;
  signTypedData(request: SourceSigningRequest): Promise<Hex>;
}

export type SettlementBatch = {
  packageId: string;
  chainId: number;
  from: `0x${string}`;
  atomicRequired: boolean;
  calls: readonly SettlementCall[];
};

export interface AtomicSettlementSimulatorPort {
  simulate(batch: SettlementBatch): Promise<SettlementSimulation>;
}

export interface DestinationSettlementWalletPort {
  getAddress(): Promise<`0x${string}`>;
  getChainId(): Promise<number>;
  supportsAtomicBatch(chainId: number, address: `0x${string}`): Promise<boolean>;
  submit(batch: SettlementBatch): Promise<DestinationSubmission>;
  waitForReceipt(submission: DestinationSubmission): Promise<DestinationReceipt>;
}
