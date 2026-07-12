import { type Address, type PublicClient } from "viem";

import { evmAddressSchema, type EvmAddress } from "@safeexit/shared";

const erc20BalanceAbi = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "balance", type: "uint256" }],
  },
] as const;

const erc20AllowanceAbi = [
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "remaining", type: "uint256" }],
  },
] as const;

const erc721OwnerAbi = [
  {
    type: "function",
    name: "ownerOf",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "owner", type: "address" }],
  },
] as const;

const erc1155BalanceAbi = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [
      { name: "account", type: "address" },
      { name: "id", type: "uint256" },
    ],
    outputs: [{ name: "balance", type: "uint256" }],
  },
] as const;

const nftOperatorApprovalAbi = [
  {
    type: "function",
    name: "isApprovedForAll",
    stateMutability: "view",
    inputs: [
      { name: "account", type: "address" },
      { name: "operator", type: "address" },
    ],
    outputs: [{ name: "approved", type: "bool" }],
  },
] as const;

export interface StandardReadClient {
  readonly id: string;
  readonly chainId: number;
  getBlockNumber(): Promise<bigint>;
  getNativeBalance(ownerAddress: EvmAddress, blockNumber: bigint): Promise<bigint>;
  getErc20Balance(
    tokenAddress: EvmAddress,
    ownerAddress: EvmAddress,
    blockNumber: bigint,
  ): Promise<bigint>;
  getErc721Owner(
    collectionAddress: EvmAddress,
    tokenId: bigint,
    blockNumber: bigint,
  ): Promise<EvmAddress>;
  getErc1155Balance(
    collectionAddress: EvmAddress,
    ownerAddress: EvmAddress,
    tokenId: bigint,
    blockNumber: bigint,
  ): Promise<bigint>;
  getErc20Allowance(
    tokenAddress: EvmAddress,
    ownerAddress: EvmAddress,
    spenderAddress: EvmAddress,
    blockNumber: bigint,
  ): Promise<bigint>;
  getNftOperatorApproval(
    collectionAddress: EvmAddress,
    ownerAddress: EvmAddress,
    operatorAddress: EvmAddress,
    blockNumber: bigint,
  ): Promise<boolean>;
}

export class ViemStandardReadClient implements StandardReadClient {
  readonly chainId: number;

  constructor(
    readonly id: string,
    private readonly client: PublicClient,
  ) {
    if (!client.chain) {
      throw new Error("A configured viem chain is required for deterministic scanning");
    }

    this.chainId = client.chain.id;
  }

  getBlockNumber(): Promise<bigint> {
    return this.client.getBlockNumber();
  }

  getNativeBalance(ownerAddress: EvmAddress, blockNumber: bigint): Promise<bigint> {
    return this.client.getBalance({
      address: ownerAddress as Address,
      blockNumber,
    });
  }

  getErc20Balance(
    tokenAddress: EvmAddress,
    ownerAddress: EvmAddress,
    blockNumber: bigint,
  ): Promise<bigint> {
    return this.client.readContract({
      address: tokenAddress as Address,
      abi: erc20BalanceAbi,
      functionName: "balanceOf",
      args: [ownerAddress as Address],
      blockNumber,
    });
  }

  async getErc721Owner(
    collectionAddress: EvmAddress,
    tokenId: bigint,
    blockNumber: bigint,
  ): Promise<EvmAddress> {
    const owner = await this.client.readContract({
      address: collectionAddress as Address,
      abi: erc721OwnerAbi,
      functionName: "ownerOf",
      args: [tokenId],
      blockNumber,
    });

    return evmAddressSchema.parse(owner);
  }

  getErc1155Balance(
    collectionAddress: EvmAddress,
    ownerAddress: EvmAddress,
    tokenId: bigint,
    blockNumber: bigint,
  ): Promise<bigint> {
    return this.client.readContract({
      address: collectionAddress as Address,
      abi: erc1155BalanceAbi,
      functionName: "balanceOf",
      args: [ownerAddress as Address, tokenId],
      blockNumber,
    });
  }

  getErc20Allowance(
    tokenAddress: EvmAddress,
    ownerAddress: EvmAddress,
    spenderAddress: EvmAddress,
    blockNumber: bigint,
  ): Promise<bigint> {
    return this.client.readContract({
      address: tokenAddress as Address,
      abi: erc20AllowanceAbi,
      functionName: "allowance",
      args: [ownerAddress as Address, spenderAddress as Address],
      blockNumber,
    });
  }

  getNftOperatorApproval(
    collectionAddress: EvmAddress,
    ownerAddress: EvmAddress,
    operatorAddress: EvmAddress,
    blockNumber: bigint,
  ): Promise<boolean> {
    return this.client.readContract({
      address: collectionAddress as Address,
      abi: nftOperatorApprovalAbi,
      functionName: "isApprovedForAll",
      args: [ownerAddress as Address, operatorAddress as Address],
      blockNumber,
    });
  }
}

