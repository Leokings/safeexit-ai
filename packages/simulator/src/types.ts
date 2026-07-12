import type { Hex } from "viem";

import type {
  EvmAddress,
  RescueAction,
  SimulationAssetChange,
  SimulationResult,
} from "@safeexit/shared";

export type SimulationRequest = {
  planId: string;
  planHash: `0x${string}`;
  action: RescueAction;
  observedAtBlock: string;
  priorGasEstimate?: string;
};

export type SimulationProviderKind =
  | "LOCAL_RPC"
  | "TEST_RPC"
  | "PRODUCTION_ADAPTER";

export type SimulationSupport = {
  supported: boolean;
  reason?: string;
};

export interface SimulationProvider {
  readonly id: string;
  readonly kind: SimulationProviderKind;
  readonly officialDocsRequired: boolean;
  supports(chainId: number, action: RescueAction): Promise<SimulationSupport>;
  simulate(request: SimulationRequest): Promise<SimulationResult>;
}

export type SimulatableCall = {
  account: EvmAddress;
  to: EvmAddress;
  blockNumber: bigint;
  value?: bigint;
  data?: Hex;
};

export type PreparedSimulationTransaction = {
  call: SimulatableCall;
  assetChanges: readonly SimulationAssetChange[];
  expectsBooleanResult?: boolean;
  gasEstimate?: bigint;
  warnings?: readonly string[];
};

export interface AdapterSimulationResolver {
  readonly id: string;
  supports(action: RescueAction): boolean;
  prepare(
    action: RescueAction,
    observedAtBlock: bigint,
  ): Promise<PreparedSimulationTransaction>;
}
