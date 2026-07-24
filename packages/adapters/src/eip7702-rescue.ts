import {
  evmAddressSchema,
  type EvmAddress,
  type RescueAction,
} from "@safeexit/shared";
import {
  encodeAbiParameters,
  encodeFunctionData,
  keccak256,
  zeroAddress,
  type Address,
  type AuthorizationRequest,
  type Hex,
} from "viem";
import { z } from "zod";

export const EIP7702_RESCUE_CHAIN_IDS = [196] as const;
export const EIP7702_MAX_ACTIONS = 256;
export const EIP7702_FULL_BALANCE = (1n << 256n) - 1n;

export const EIP7702_ACTION_KIND = {
  TRANSFER_NATIVE: 0,
  TRANSFER_ERC20: 1,
  TRANSFER_ERC721: 2,
  TRANSFER_ERC1155: 3,
  REVOKE_ERC20_APPROVAL: 4,
  REVOKE_NFT_OPERATOR: 5,
} as const;

const uint256Schema = z
  .bigint()
  .nonnegative()
  .max(EIP7702_FULL_BALANCE);

export const eip7702RescueActionSchema = z.strictObject({
  kind: z.union([
    z.literal(EIP7702_ACTION_KIND.TRANSFER_NATIVE),
    z.literal(EIP7702_ACTION_KIND.TRANSFER_ERC20),
    z.literal(EIP7702_ACTION_KIND.TRANSFER_ERC721),
    z.literal(EIP7702_ACTION_KIND.TRANSFER_ERC1155),
    z.literal(EIP7702_ACTION_KIND.REVOKE_ERC20_APPROVAL),
    z.literal(EIP7702_ACTION_KIND.REVOKE_NFT_OPERATOR),
  ]),
  asset: evmAddressSchema,
  counterparty: evmAddressSchema,
  tokenId: uint256Schema,
  amount: uint256Schema,
});

export const eip7702RescuePlanSchema = z.strictObject({
  chainId: z.literal(196),
  sourceAddress: evmAddressSchema,
  destinationAddress: evmAddressSchema,
  delegateAddress: evmAddressSchema,
  deadline: z.number().int().positive().safe(),
  rescueNonce: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
  actions: z
    .array(eip7702RescueActionSchema)
    .min(1)
    .max(EIP7702_MAX_ACTIONS),
});

export type Eip7702RescueAction = z.infer<typeof eip7702RescueActionSchema>;
export type Eip7702RescuePlan = z.infer<typeof eip7702RescuePlanSchema>;

const rescueActionArrayParameter = [
  {
    name: "plan",
    type: "tuple[]",
    components: [
      { name: "kind", type: "uint8" },
      { name: "asset", type: "address" },
      { name: "counterparty", type: "address" },
      { name: "tokenId", type: "uint256" },
      { name: "amount", type: "uint256" },
    ],
  },
] as const;

const rescueActionTuple = {
  name: "plan",
  type: "tuple[]",
  components: rescueActionArrayParameter[0].components,
} as const;

export const eip7702RescueDelegateAbi = [
  {
    type: "function",
    name: "CHAIN_ID",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "SOURCE",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "DESTINATION",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "DEADLINE",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "PLAN_HASH",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "bytes32" }],
  },
  {
    type: "function",
    name: "RESCUE_NONCE",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "bytes32" }],
  },
  {
    type: "function",
    name: "execute",
    stateMutability: "nonpayable",
    inputs: [
      rescueActionTuple,
      { name: "indexes", type: "uint256[]" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "hashPlan",
    stateMutability: "pure",
    inputs: [rescueActionTuple],
    outputs: [{ name: "", type: "bytes32" }],
  },
  {
    type: "function",
    name: "executionBitmap",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

export const eip7702RescueDelegateFactoryAbi = [
  {
    type: "function",
    name: "deployDelegate",
    stateMutability: "nonpayable",
    inputs: [
      { name: "source", type: "address" },
      { name: "destination", type: "address" },
      { name: "deadline", type: "uint256" },
      { name: "planHash", type: "bytes32" },
      { name: "rescueNonce", type: "bytes32" },
    ],
    outputs: [{ name: "delegate", type: "address" }],
  },
  {
    type: "function",
    name: "predictDelegate",
    stateMutability: "view",
    inputs: [
      { name: "source", type: "address" },
      { name: "destination", type: "address" },
      { name: "deadline", type: "uint256" },
      { name: "planHash", type: "bytes32" },
      { name: "rescueNonce", type: "bytes32" },
    ],
    outputs: [{ name: "", type: "address" }],
  },
] as const;

function asAddress(address: EvmAddress): Address {
  return address as Address;
}

function sameAddress(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function requireReadyAction(
  action: RescueAction,
  sourceAddress: EvmAddress,
): void {
  if (!sameAddress(action.sourceAddress, sourceAddress)) {
    throw new Error(`Action ${action.id} belongs to a different source wallet`);
  }
  if (action.supportStatus !== "SUPPORTED") {
    throw new Error(`Action ${action.id} is not supported`);
  }
  if (action.simulationStatus !== "PASSED") {
    throw new Error(`Action ${action.id} has not passed deterministic simulation`);
  }
}

function destinationCounterparty(
  recipient: EvmAddress,
  destinationAddress: EvmAddress,
  actionId: string,
): EvmAddress {
  if (!sameAddress(recipient, destinationAddress)) {
    throw new Error(`Action ${actionId} does not commit to the safe destination`);
  }
  return destinationAddress;
}

export function toEip7702RescueActions(
  actions: readonly RescueAction[],
  sourceAddress: EvmAddress,
  destinationAddress: EvmAddress,
): readonly Eip7702RescueAction[] {
  if (sameAddress(sourceAddress, destinationAddress)) {
    throw new Error("Source and destination addresses must be different");
  }

  return actions.map((action): Eip7702RescueAction => {
    requireReadyAction(action, sourceAddress);

    switch (action.actionType) {
      case "TRANSFER_NATIVE":
        return eip7702RescueActionSchema.parse({
          kind: EIP7702_ACTION_KIND.TRANSFER_NATIVE,
          asset: zeroAddress,
          counterparty: destinationCounterparty(
            action.parameters.recipient,
            destinationAddress,
            action.id,
          ),
          tokenId: 0n,
          // The destination pays the outer transaction gas, so the delegated
          // source can safely transfer its complete live native balance.
          amount: EIP7702_FULL_BALANCE,
        });
      case "TRANSFER_ERC20":
        return eip7702RescueActionSchema.parse({
          kind: EIP7702_ACTION_KIND.TRANSFER_ERC20,
          asset: action.parameters.tokenAddress,
          counterparty: destinationCounterparty(
            action.parameters.recipient,
            destinationAddress,
            action.id,
          ),
          tokenId: 0n,
          amount: BigInt(action.parameters.amount),
        });
      case "TRANSFER_ERC721":
        return eip7702RescueActionSchema.parse({
          kind: EIP7702_ACTION_KIND.TRANSFER_ERC721,
          asset: action.parameters.collectionAddress,
          counterparty: destinationCounterparty(
            action.parameters.recipient,
            destinationAddress,
            action.id,
          ),
          tokenId: BigInt(action.parameters.tokenId),
          amount: 1n,
        });
      case "TRANSFER_ERC1155":
        return eip7702RescueActionSchema.parse({
          kind: EIP7702_ACTION_KIND.TRANSFER_ERC1155,
          asset: action.parameters.collectionAddress,
          counterparty: destinationCounterparty(
            action.parameters.recipient,
            destinationAddress,
            action.id,
          ),
          tokenId: BigInt(action.parameters.tokenId),
          amount: BigInt(action.parameters.amount),
        });
      case "REVOKE_ERC20_APPROVAL":
        return eip7702RescueActionSchema.parse({
          kind: EIP7702_ACTION_KIND.REVOKE_ERC20_APPROVAL,
          asset: action.parameters.tokenAddress,
          counterparty: action.parameters.spenderAddress,
          tokenId: 0n,
          amount: 0n,
        });
      case "REVOKE_NFT_OPERATOR":
        return eip7702RescueActionSchema.parse({
          kind: EIP7702_ACTION_KIND.REVOKE_NFT_OPERATOR,
          asset: action.parameters.collectionAddress,
          counterparty: action.parameters.operatorAddress,
          tokenId: 0n,
          amount: 0n,
        });
      default:
        throw new Error(
          `Action ${action.id} requires a protocol-specific delegate adapter`,
        );
    }
  });
}

export function hashEip7702RescuePlan(
  actions: readonly Eip7702RescueAction[],
): Hex {
  const parsed = z
    .array(eip7702RescueActionSchema)
    .min(1)
    .max(EIP7702_MAX_ACTIONS)
    .parse(actions);

  return keccak256(
    encodeAbiParameters(
      rescueActionArrayParameter,
      [
        parsed.map((action) => ({
          kind: action.kind,
          asset: asAddress(action.asset),
          counterparty: asAddress(action.counterparty),
          tokenId: action.tokenId,
          amount: action.amount,
        })),
      ],
    ),
  );
}

function validateExecutionIndexes(
  indexes: readonly number[],
  planLength: number,
): readonly bigint[] {
  if (indexes.length === 0) {
    throw new Error("At least one EIP-7702 rescue action must be selected");
  }

  let previous = -1;
  return indexes.map((index) => {
    if (!Number.isSafeInteger(index) || index < 0 || index >= planLength) {
      throw new Error(`EIP-7702 rescue action index ${index} is out of bounds`);
    }
    if (index <= previous) {
      throw new Error("EIP-7702 rescue action indexes must be strictly increasing");
    }
    previous = index;
    return BigInt(index);
  });
}

export function encodeEip7702ExecutionCall(
  actions: readonly Eip7702RescueAction[],
  indexes: readonly number[],
): Hex {
  const parsed = z
    .array(eip7702RescueActionSchema)
    .min(1)
    .max(EIP7702_MAX_ACTIONS)
    .parse(actions);
  const encodedIndexes = validateExecutionIndexes(indexes, parsed.length);

  return encodeFunctionData({
    abi: eip7702RescueDelegateAbi,
    functionName: "execute",
    args: [
      parsed.map((action) => ({
        kind: action.kind,
        asset: asAddress(action.asset),
        counterparty: asAddress(action.counterparty),
        tokenId: action.tokenId,
        amount: action.amount,
      })),
      encodedIndexes,
    ],
  });
}

export type Eip7702AuthorizationPair = {
  delegation: AuthorizationRequest;
  revocation: AuthorizationRequest;
};

/**
 * Builds the source EOA authorizations only. It never signs them and never
 * accepts a private key. The revocation nonce follows the protocol-mandated
 * nonce increment performed while the delegation authorization is processed.
 */
export function buildEip7702AuthorizationPair(input: {
  chainId: number;
  delegateAddress: EvmAddress;
  sourceNonce: number;
}): Eip7702AuthorizationPair {
  if (!(EIP7702_RESCUE_CHAIN_IDS as readonly number[]).includes(input.chainId)) {
    throw new Error(`EIP-7702 rescue is not enabled for chain ${input.chainId}`);
  }
  if (
    !Number.isSafeInteger(input.sourceNonce) ||
    input.sourceNonce < 0 ||
    !Number.isSafeInteger(input.sourceNonce + 1)
  ) {
    throw new Error("Source nonce must be a non-negative safe integer");
  }

  return {
    delegation: {
      address: asAddress(input.delegateAddress),
      chainId: input.chainId,
      nonce: input.sourceNonce,
    },
    revocation: {
      address: zeroAddress,
      chainId: input.chainId,
      nonce: input.sourceNonce + 1,
    },
  };
}
