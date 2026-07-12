import { encodeFunctionData, type Address, type Hex } from "viem";

import { verifyPlanIntegrity } from "@safeexit/planner";
import {
  rescuePlanSchema,
  simulationResultSchema,
  type RescueAction,
  type RescuePlan,
  type SimulationResult,
} from "@safeexit/shared";

const erc20TransferAbi = [{
  type: "function",
  name: "transfer",
  stateMutability: "nonpayable",
  inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }],
  outputs: [{ name: "success", type: "bool" }],
}] as const;

const erc20ApproveAbi = [{
  type: "function",
  name: "approve",
  stateMutability: "nonpayable",
  inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }],
  outputs: [{ name: "success", type: "bool" }],
}] as const;

const erc721TransferAbi = [{
  type: "function",
  name: "safeTransferFrom",
  stateMutability: "nonpayable",
  inputs: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "tokenId", type: "uint256" },
  ],
  outputs: [],
}] as const;

const erc1155TransferAbi = [{
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
}] as const;

const nftOperatorApprovalAbi = [{
  type: "function",
  name: "setApprovalForAll",
  stateMutability: "nonpayable",
  inputs: [{ name: "operator", type: "address" }, { name: "approved", type: "bool" }],
  outputs: [],
}] as const;

export type PreparedWalletTransaction = {
  actionId: string;
  chainId: number;
  from: Address;
  to: Address;
  value: Hex;
  data?: Hex;
};

function toHex(value: bigint): Hex {
  return `0x${value.toString(16)}`;
}

function transactionForAction(
  action: RescueAction,
  simulation: SimulationResult,
): PreparedWalletTransaction {
  const common = {
    actionId: action.id,
    chainId: action.chainId,
    from: action.sourceAddress as Address,
    value: "0x0" as Hex,
  };
  switch (action.actionType) {
    case "TRANSFER_NATIVE": {
      const debit = simulation.assetChanges.find(
        (change) =>
          change.assetType === "NATIVE" &&
          change.direction === "DEBIT" &&
          change.account.toLowerCase() === action.sourceAddress.toLowerCase(),
      );
      if (!debit || BigInt(debit.amount) <= 0n) {
        throw new Error("Native transfer requires a positive preflight-resolved amount");
      }
      if (BigInt(debit.amount) > BigInt(action.parameters.maximumAmount)) {
        throw new Error("Resolved native amount exceeds the plan maximum");
      }
      return {
        ...common,
        to: action.parameters.recipient as Address,
        value: toHex(BigInt(debit.amount)),
      };
    }
    case "TRANSFER_ERC20":
      return {
        ...common,
        to: action.parameters.tokenAddress as Address,
        data: encodeFunctionData({
          abi: erc20TransferAbi,
          functionName: "transfer",
          args: [
            action.parameters.recipient as Address,
            BigInt(action.parameters.amount),
          ],
        }),
      };
    case "TRANSFER_ERC721":
      return {
        ...common,
        to: action.parameters.collectionAddress as Address,
        data: encodeFunctionData({
          abi: erc721TransferAbi,
          functionName: "safeTransferFrom",
          args: [
            action.sourceAddress as Address,
            action.parameters.recipient as Address,
            BigInt(action.parameters.tokenId),
          ],
        }),
      };
    case "TRANSFER_ERC1155":
      return {
        ...common,
        to: action.parameters.collectionAddress as Address,
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
      };
    case "REVOKE_ERC20_APPROVAL":
      return {
        ...common,
        to: action.parameters.tokenAddress as Address,
        data: encodeFunctionData({
          abi: erc20ApproveAbi,
          functionName: "approve",
          args: [action.parameters.spenderAddress as Address, 0n],
        }),
      };
    case "REVOKE_NFT_OPERATOR":
      return {
        ...common,
        to: action.parameters.collectionAddress as Address,
        data: encodeFunctionData({
          abi: nftOperatorApprovalAbi,
          functionName: "setApprovalForAll",
          args: [action.parameters.operatorAddress as Address, false],
        }),
      };
    case "CLAIM_SUPPORTED_AIRDROP":
    case "WITHDRAW_SUPPORTED_POSITION":
    case "CUSTOM_SUPPORTED_ADAPTER":
      throw new Error("Adapter actions require a separately reviewed transaction builder");
  }
}

export function prepareWalletTransaction(
  planValue: RescuePlan,
  simulationValue: SimulationResult,
  now = new Date(),
): PreparedWalletTransaction {
  const plan = rescuePlanSchema.parse(planValue);
  const simulation = simulationResultSchema.parse(simulationValue);
  if (!verifyPlanIntegrity(plan)) {
    throw new Error("Rescue plan integrity verification failed");
  }
  if (simulation.planId !== plan.id || simulation.planHash !== plan.integrityHash) {
    throw new Error("Simulation does not match the verified rescue plan");
  }
  if (simulation.status !== "SUCCEEDED") {
    throw new Error("Only successfully preflighted actions can be prepared");
  }
  if (new Date(simulation.expiresAt).getTime() <= now.getTime()) {
    throw new Error("Preflight result has expired");
  }
  const action = plan.actions.find((candidate) => candidate.id === simulation.actionId);
  if (!action) {
    throw new Error("Simulation action is not present in the rescue plan");
  }
  return transactionForAction(action, simulation);
}
