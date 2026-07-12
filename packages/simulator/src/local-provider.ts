import {
  decodeAbiParameters,
  encodeFunctionData,
  type Address,
  type Hex,
} from "viem";

import type {
  EvmAddress,
  RescueAction,
  SimulationAssetChange,
  SimulationResult,
} from "@safeexit/shared";

import type { LocalSimulationClient } from "./client";
import { createSimulationResult } from "./result";
import type {
  AdapterSimulationResolver,
  PreparedSimulationTransaction,
  SimulationProvider,
  SimulationProviderKind,
  SimulationRequest,
  SimulationSupport,
} from "./types";

const erc20TransferAbi = [
  {
    type: "function",
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "success", type: "bool" }],
  },
] as const;

const erc20ApproveAbi = [
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "success", type: "bool" }],
  },
] as const;

const erc721TransferAbi = [
  {
    type: "function",
    name: "safeTransferFrom",
    stateMutability: "nonpayable",
    inputs: [
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "tokenId", type: "uint256" },
    ],
    outputs: [],
  },
] as const;

const erc1155TransferAbi = [
  {
    type: "function",
    name: "safeTransferFrom",
    stateMutability: "nonpayable",
    inputs: [
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "id", type: "uint256" },
      { name: "amount", type: "uint256" },
      { name: "data", type: "bytes" },
    ],
    outputs: [],
  },
] as const;

const nftOperatorApprovalAbi = [
  {
    type: "function",
    name: "setApprovalForAll",
    stateMutability: "nonpayable",
    inputs: [
      { name: "operator", type: "address" },
      { name: "approved", type: "bool" },
    ],
    outputs: [],
  },
] as const;

const inferredEffectsWarning =
  "Asset changes are inferred from the typed action after a successful call; they are not a full state diff.";

type AssetChangeWithoutAccount<T = SimulationAssetChange> =
  T extends SimulationAssetChange ? Omit<T, "account" | "direction"> : never;

function transferChanges(
  asset: AssetChangeWithoutAccount,
  source: EvmAddress,
  destination: EvmAddress,
): SimulationAssetChange[] {
  return [
    { ...asset, account: source, direction: "DEBIT" },
    { ...asset, account: destination, direction: "CREDIT" },
  ] as SimulationAssetChange[];
}

function isAdapterAction(action: RescueAction): boolean {
  return (
    action.actionType === "CLAIM_SUPPORTED_AIRDROP" ||
    action.actionType === "WITHDRAW_SUPPORTED_POSITION" ||
    action.actionType === "CUSTOM_SUPPORTED_ADAPTER"
  );
}

function cleanErrorText(value: string): string {
  return value
    .replace(/https?:\/\/\S+/gi, "[redacted-url]")
    .replace(/\s+/g, " ")
    .trim();
}

function errorReason(error: unknown): string {
  const messages: string[] = [];
  const visited = new Set<unknown>();
  let current: unknown = error;

  for (let depth = 0; depth < 5 && current; depth += 1) {
    if (visited.has(current)) {
      break;
    }
    visited.add(current);

    if (typeof current === "string") {
      messages.push(current);
      break;
    }
    if (current instanceof Error) {
      messages.push(current.message);
    }
    if (typeof current === "object") {
      const record = current as Record<string, unknown>;
      for (const key of ["reason", "shortMessage", "details"] as const) {
        if (typeof record[key] === "string") {
          messages.push(record[key]);
        }
      }
      current = record.cause;
    } else {
      break;
    }
  }

  const reason = [...new Set(messages.map(cleanErrorText).filter(Boolean))].join(" | ");
  return (reason || "Simulation failed without a provider reason").slice(0, 1_000);
}

export type LocalSimulationProviderOptions = {
  id: string;
  kind: Extract<
    SimulationProviderKind,
    "LOCAL_RPC" | "TEST_RPC" | "PRODUCTION_RPC"
  >;
  client: LocalSimulationClient;
  adapterResolvers?: readonly AdapterSimulationResolver[];
  clock?: () => Date;
  ttlMs?: number;
};

export class LocalSimulationProvider implements SimulationProvider {
  readonly id: string;
  readonly kind: Extract<
    SimulationProviderKind,
    "LOCAL_RPC" | "TEST_RPC" | "PRODUCTION_RPC"
  >;
  readonly officialDocsRequired = false;
  private readonly clock: () => Date;
  private readonly ttlMs: number;
  private readonly resolvers: readonly AdapterSimulationResolver[];

  constructor(private readonly options: LocalSimulationProviderOptions) {
    this.id = options.id;
    this.kind = options.kind;
    this.clock = options.clock ?? (() => new Date());
    this.ttlMs = options.ttlMs ?? 60_000;
    this.resolvers = options.adapterResolvers ?? [];
  }

  async supports(chainId: number, action: RescueAction): Promise<SimulationSupport> {
    if (chainId !== this.options.client.chainId || action.chainId !== chainId) {
      return { supported: false, reason: "Simulation chain does not match the action" };
    }

    if (!isAdapterAction(action)) {
      return { supported: true };
    }

    const resolver = this.resolvers.find((candidate) => candidate.supports(action));
    return resolver
      ? { supported: true }
      : {
          supported: false,
          reason: "Adapter action requires a reviewed local simulation resolver",
        };
  }

  async simulate(request: SimulationRequest): Promise<SimulationResult> {
    const support = await this.supports(request.action.chainId, request.action);
    if (!support.supported) {
      return createSimulationResult({
        providerId: this.id,
        request,
        status: "UNSUPPORTED",
        failureReason: support.reason ?? "Action is not supported by this provider",
        clock: this.clock,
        ttlMs: this.ttlMs,
      });
    }

    try {
      const prepared = await this.prepare(
        request.action,
        BigInt(request.observedAtBlock),
        BigInt(request.priorGasEstimate ?? "0"),
      );
      const returnData = await this.options.client.call(prepared.call);
      this.validateReturnData(prepared, returnData);
      const gasEstimate =
        prepared.gasEstimate ?? (await this.options.client.estimateGas(prepared.call));
      const warnings = [
        ...(prepared.warnings ?? []),
        ...(prepared.assetChanges.length > 0 ? [inferredEffectsWarning] : []),
      ];

      return createSimulationResult({
        providerId: this.id,
        request,
        status: "SUCCEEDED",
        gasEstimate,
        assetChanges: prepared.assetChanges,
        warnings,
        clock: this.clock,
        ttlMs: this.ttlMs,
      });
    } catch (error) {
      const reason = errorReason(error);
      return createSimulationResult({
        providerId: this.id,
        request,
        status: /revert/i.test(reason) ? "REVERTED" : "ERROR",
        failureReason: reason,
        clock: this.clock,
        ttlMs: this.ttlMs,
      });
    }
  }

  private async prepare(
    action: RescueAction,
    blockNumber: bigint,
    priorGasEstimate: bigint,
  ): Promise<PreparedSimulationTransaction> {
    switch (action.actionType) {
      case "TRANSFER_NATIVE": {
        const preliminaryCall = {
          account: action.sourceAddress,
          to: action.parameters.recipient,
          value: 0n,
          blockNumber,
        };
        const gasEstimate = await this.options.client.estimateGas(preliminaryCall);
        const [gasPrice, balance] = await Promise.all([
          this.options.client.getGasPrice(),
          this.options.client.getBalance(action.sourceAddress, blockNumber),
        ]);
        const maximumAmount = BigInt(action.parameters.maximumAmount);
        const cappedBalance = balance < maximumAmount ? balance : maximumAmount;
        const gasReserve = (gasEstimate + priorGasEstimate) * gasPrice;
        const transferAmount = cappedBalance - gasReserve;
        if (transferAmount <= 0n) {
          throw new Error("Insufficient native balance after reserving estimated gas");
        }

        return {
          call: {
            ...preliminaryCall,
            value: transferAmount,
          },
          gasEstimate,
          assetChanges: transferChanges(
            { assetType: "NATIVE", amount: transferAmount.toString() },
            action.sourceAddress,
            action.parameters.recipient,
          ),
          warnings: [
            `Reserved ${gasReserve.toString()} base units for this and earlier estimated execution gas.`,
          ],
        };
      }
      case "TRANSFER_ERC20":
        return {
          call: {
            account: action.sourceAddress,
            to: action.parameters.tokenAddress,
            blockNumber,
            data: encodeFunctionData({
              abi: erc20TransferAbi,
              functionName: "transfer",
              args: [
                action.parameters.recipient as Address,
                BigInt(action.parameters.amount),
              ],
            }),
          },
          expectsBooleanResult: true,
          assetChanges: transferChanges(
            {
              assetType: "ERC20",
              contractAddress: action.parameters.tokenAddress,
              amount: action.parameters.amount,
            },
            action.sourceAddress,
            action.parameters.recipient,
          ),
        };
      case "TRANSFER_ERC721":
        return {
          call: {
            account: action.sourceAddress,
            to: action.parameters.collectionAddress,
            blockNumber,
            data: encodeFunctionData({
              abi: erc721TransferAbi,
              functionName: "safeTransferFrom",
              args: [
                action.sourceAddress as Address,
                action.parameters.recipient as Address,
                BigInt(action.parameters.tokenId),
              ],
            }),
          },
          assetChanges: transferChanges(
            {
              assetType: "ERC721",
              contractAddress: action.parameters.collectionAddress,
              tokenId: action.parameters.tokenId,
              amount: "1",
            },
            action.sourceAddress,
            action.parameters.recipient,
          ),
        };
      case "TRANSFER_ERC1155":
        return {
          call: {
            account: action.sourceAddress,
            to: action.parameters.collectionAddress,
            blockNumber,
            data: encodeFunctionData({
              abi: erc1155TransferAbi,
              functionName: "safeTransferFrom",
              args: [
                action.sourceAddress as Address,
                action.parameters.recipient as Address,
                BigInt(action.parameters.tokenId),
                BigInt(action.parameters.amount),
                "0x",
              ],
            }),
          },
          assetChanges: transferChanges(
            {
              assetType: "ERC1155",
              contractAddress: action.parameters.collectionAddress,
              tokenId: action.parameters.tokenId,
              amount: action.parameters.amount,
            },
            action.sourceAddress,
            action.parameters.recipient,
          ),
        };
      case "REVOKE_ERC20_APPROVAL":
        return {
          call: {
            account: action.sourceAddress,
            to: action.parameters.tokenAddress,
            blockNumber,
            data: encodeFunctionData({
              abi: erc20ApproveAbi,
              functionName: "approve",
              args: [action.parameters.spenderAddress as Address, 0n],
            }),
          },
          expectsBooleanResult: true,
          assetChanges: [],
        };
      case "REVOKE_NFT_OPERATOR":
        return {
          call: {
            account: action.sourceAddress,
            to: action.parameters.collectionAddress,
            blockNumber,
            data: encodeFunctionData({
              abi: nftOperatorApprovalAbi,
              functionName: "setApprovalForAll",
              args: [action.parameters.operatorAddress as Address, false],
            }),
          },
          assetChanges: [],
        };
      case "CLAIM_SUPPORTED_AIRDROP":
      case "WITHDRAW_SUPPORTED_POSITION":
      case "CUSTOM_SUPPORTED_ADAPTER": {
        const resolver = this.resolvers.find((candidate) => candidate.supports(action));
        if (!resolver) {
          throw new Error("Adapter action has no reviewed local simulation resolver");
        }
        return resolver.prepare(action, blockNumber);
      }
    }
  }

  private validateReturnData(
    prepared: PreparedSimulationTransaction,
    returnData: Hex | undefined,
  ): void {
    if (!prepared.expectsBooleanResult) {
      return;
    }
    if (!returnData || returnData === "0x") {
      throw new Error("Expected a boolean success result from the token contract");
    }
    const [success] = decodeAbiParameters([{ type: "bool" }], returnData);
    if (!success) {
      throw new Error("Token contract returned false during simulation");
    }
  }
}
