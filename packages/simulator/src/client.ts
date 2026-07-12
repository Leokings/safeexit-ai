import type { Address, Hex, PublicClient } from "viem";

import type { EvmAddress } from "@safeexit/shared";

import type { SimulatableCall } from "./types";

export interface LocalSimulationClient {
  readonly id: string;
  readonly chainId: number;
  call(request: SimulatableCall): Promise<Hex | undefined>;
  estimateGas(request: SimulatableCall): Promise<bigint>;
  getBalance(account: EvmAddress, blockNumber: bigint): Promise<bigint>;
  getGasPrice(): Promise<bigint>;
}

function toViemRequest(request: SimulatableCall) {
  return {
    account: request.account as Address,
    to: request.to as Address,
    blockNumber: request.blockNumber,
    ...(request.value !== undefined ? { value: request.value } : {}),
    ...(request.data !== undefined ? { data: request.data } : {}),
  };
}

export class ViemLocalSimulationClient implements LocalSimulationClient {
  readonly chainId: number;

  constructor(
    readonly id: string,
    private readonly client: PublicClient,
  ) {
    if (!client.chain) {
      throw new Error("A configured viem chain is required for local simulation");
    }
    this.chainId = client.chain.id;
  }

  async call(request: SimulatableCall): Promise<Hex | undefined> {
    const result = await this.client.call(toViemRequest(request));
    return result.data;
  }

  estimateGas(request: SimulatableCall): Promise<bigint> {
    return this.client.estimateGas(toViemRequest(request));
  }

  getBalance(account: EvmAddress, blockNumber: bigint): Promise<bigint> {
    return this.client.getBalance({
      address: account as Address,
      blockNumber,
    });
  }

  getGasPrice(): Promise<bigint> {
    return this.client.getGasPrice();
  }
}

