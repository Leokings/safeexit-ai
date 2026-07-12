import type {
  EvmAddress,
  RescueAction,
  SupportStatus,
} from "@safeexit/shared";

export type AdapterContext = {
  chainId: number;
  ownerAddress: EvmAddress;
  observedAtBlock: string;
};

export type AdapterPositionEvidence = {
  id: string;
  adapterId: string;
  contractAddress: EvmAddress;
  supportStatus: SupportStatus;
  observedAtBlock: string;
};

export interface PositionAdapter {
  readonly id: string;
  readonly supportedChains: readonly number[];
  discover(context: AdapterContext): Promise<readonly AdapterPositionEvidence[]>;
  buildActions(
    position: AdapterPositionEvidence,
    destinationAddress: EvmAddress,
  ): readonly RescueAction[];
}

