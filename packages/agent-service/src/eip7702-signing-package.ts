import {
  EIP7702_ACTION_KIND,
  EIP7702_FULL_BALANCE,
  EIP7702_MAX_ACTIONS,
  eip7702RescueActionSchema,
  hashEip7702RescuePlan,
  type Eip7702RescueAction,
} from "@safeexit/adapters/eip7702-rescue";
import { evmAddressSchema } from "@safeexit/shared";
import { z } from "zod";

const zeroAddress = "0x0000000000000000000000000000000000000000";
const identifierSchema = z.string().min(1).max(256);
const timestampSchema = z.string().datetime({ offset: true });
const hashSchema = z.string().regex(/^0x[a-fA-F0-9]{64}$/);
const nonzeroHashSchema = hashSchema.refine(
  (value) => !/^0x0{64}$/i.test(value),
  "Hash must not be zero",
);
const blockNumberSchema = z.string().regex(/^(0|[1-9]\d*)$/);
const uint256StringSchema = z
  .string()
  .regex(/^(0|[1-9]\d*)$/)
  .refine((value) => BigInt(value) <= EIP7702_FULL_BALANCE, "Value exceeds uint256");

export const eip7702PackageActionSchema = z.strictObject({
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
  tokenId: uint256StringSchema,
  amount: uint256StringSchema,
});

const packagePolicySchema = z.strictObject({
  sourceSignsLocally: z.literal(true),
  destinationPaysAllGas: z.literal(true),
  privateCredentialsAccepted: z.literal(false),
  authorizationsReturnedToSafeExit: z.literal(false),
  arbitraryCallsAllowed: z.literal(false),
  postAuthorizationSimulationRequired: z.literal(true),
  delegationClearRequired: z.literal(true),
});

const simulationCommitmentSchema = z.strictObject({
  resultIds: z.array(identifierSchema).min(1).max(EIP7702_MAX_ACTIONS),
  providerId: z.string().min(1).max(128),
  status: z.literal("SUCCEEDED"),
  expiresAt: timestampSchema,
});

function sameAddress(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function isZeroAddress(value: string): boolean {
  return sameAddress(value, zeroAddress);
}

function actionToAdapter(
  action: z.infer<typeof eip7702PackageActionSchema>,
): Eip7702RescueAction {
  return eip7702RescueActionSchema.parse({
    ...action,
    tokenId: BigInt(action.tokenId),
    amount: BigInt(action.amount),
  });
}

export const eip7702LocalSigningPackageSchema = z
  .strictObject({
    schemaVersion: z.literal("safeexit-eip7702-signing-package-v1"),
    packageId: identifierSchema,
    jobId: identifierSchema,
    incidentId: identifierSchema,
    planId: identifierSchema,
    planHash: nonzeroHashSchema,
    delegatePlanHash: nonzeroHashSchema,
    route: z.literal("EIP7702_DELEGATED_RESCUE"),
    chainId: z.literal(196),
    sourceAddress: evmAddressSchema,
    destinationAddress: evmAddressSchema,
    observedAtBlock: blockNumberSchema,
    expiresAt: timestampSchema,
    deadline: z.number().int().positive().safe(),
    sourceNonce: z
      .number()
      .int()
      .nonnegative()
      .max(Number.MAX_SAFE_INTEGER - 2),
    rescueNonce: nonzeroHashSchema,
    factoryAddress: evmAddressSchema,
    factoryRuntimeHash: nonzeroHashSchema,
    delegateAddress: evmAddressSchema,
    actionIds: z.array(identifierSchema).min(1).max(EIP7702_MAX_ACTIONS),
    actions: z
      .array(eip7702PackageActionSchema)
      .min(1)
      .max(EIP7702_MAX_ACTIONS),
    executionIndexes: z
      .array(z.number().int().nonnegative().safe())
      .min(1)
      .max(EIP7702_MAX_ACTIONS),
    simulation: simulationCommitmentSchema,
    policy: packagePolicySchema,
  })
  .superRefine((value, context) => {
    if (sameAddress(value.sourceAddress, value.destinationAddress)) {
      context.addIssue({
        code: "custom",
        message: "EIP-7702 source and destination must be different",
        path: ["destinationAddress"],
      });
    }
    for (const [field, address] of [
      ["factoryAddress", value.factoryAddress],
      ["delegateAddress", value.delegateAddress],
    ] as const) {
      if (
        isZeroAddress(address) ||
        sameAddress(address, value.sourceAddress) ||
        sameAddress(address, value.destinationAddress)
      ) {
        context.addIssue({
          code: "custom",
          message: `${field} is not a valid incident contract address`,
          path: [field],
        });
      }
    }
    if (sameAddress(value.factoryAddress, value.delegateAddress)) {
      context.addIssue({
        code: "custom",
        message: "Factory and incident delegate must be different contracts",
        path: ["delegateAddress"],
      });
    }
    if (value.actionIds.length !== value.actions.length) {
      context.addIssue({
        code: "custom",
        message: "Every delegated action must have one action ID",
        path: ["actionIds"],
      });
    }
    if (new Set(value.actionIds).size !== value.actionIds.length) {
      context.addIssue({
        code: "custom",
        message: "Delegated action IDs must be unique",
        path: ["actionIds"],
      });
    }
    if (
      value.simulation.resultIds.length !== value.executionIndexes.length ||
      new Set(value.simulation.resultIds).size !== value.simulation.resultIds.length
    ) {
      context.addIssue({
        code: "custom",
        message: "Every selected action must commit one unique simulation result",
        path: ["simulation", "resultIds"],
      });
    }
    if (value.executionIndexes.length !== value.actions.length) {
      context.addIssue({
        code: "custom",
        message: "Every delegated action must be selected for execution",
        path: ["executionIndexes"],
      });
    }

    let previous = -1;
    for (const [position, index] of value.executionIndexes.entries()) {
      if (index >= value.actions.length) {
        context.addIssue({
          code: "custom",
          message: "Delegated action index is out of bounds",
          path: ["executionIndexes", position],
        });
      }
      if (index <= previous) {
        context.addIssue({
          code: "custom",
          message: "Delegated action indexes must be strictly increasing",
          path: ["executionIndexes", position],
        });
      }
      if (index !== position) {
        context.addIssue({
          code: "custom",
          message: "Delegated action indexes must cover the complete plan in order",
          path: ["executionIndexes", position],
        });
      }
      previous = index;
    }

    const expiresAtSeconds = Math.floor(Date.parse(value.expiresAt) / 1_000);
    if (expiresAtSeconds !== value.deadline) {
      context.addIssue({
        code: "custom",
        message: "Package expiry must exactly match the delegate deadline",
        path: ["deadline"],
      });
    }
    if (Date.parse(value.simulation.expiresAt) <= Date.parse(value.expiresAt)) {
      context.addIssue({
        code: "custom",
        message: "Committed simulation must outlive the EIP-7702 package",
        path: ["simulation", "expiresAt"],
      });
    }

    const actions = value.actions.map(actionToAdapter);
    if (hashEip7702RescuePlan(actions).toLowerCase() !== value.delegatePlanHash.toLowerCase()) {
      context.addIssue({
        code: "custom",
        message: "Delegated action plan does not match its committed hash",
        path: ["delegatePlanHash"],
      });
    }

    value.actions.forEach((action, index) => {
      const amount = BigInt(action.amount);
      const tokenId = BigInt(action.tokenId);
      const transferCounterpartyMatches = sameAddress(
        action.counterparty,
        value.destinationAddress,
      );
      switch (action.kind) {
        case EIP7702_ACTION_KIND.TRANSFER_NATIVE:
          if (
            !isZeroAddress(action.asset) ||
            !transferCounterpartyMatches ||
            tokenId !== 0n ||
            amount !== EIP7702_FULL_BALANCE
          ) {
            context.addIssue({
              code: "custom",
              message: "Native rescue must transfer the complete live balance to the destination",
              path: ["actions", index],
            });
          }
          break;
        case EIP7702_ACTION_KIND.TRANSFER_ERC20:
          if (
            isZeroAddress(action.asset) ||
            sameAddress(action.asset, value.sourceAddress) ||
            !transferCounterpartyMatches ||
            tokenId !== 0n ||
            amount === 0n
          ) {
            context.addIssue({
              code: "custom",
              message: "ERC-20 rescue action has an invalid fixed scope",
              path: ["actions", index],
            });
          }
          break;
        case EIP7702_ACTION_KIND.TRANSFER_ERC721:
          if (
            isZeroAddress(action.asset) ||
            sameAddress(action.asset, value.sourceAddress) ||
            !transferCounterpartyMatches ||
            amount !== 1n
          ) {
            context.addIssue({
              code: "custom",
              message: "ERC-721 rescue action has an invalid fixed scope",
              path: ["actions", index],
            });
          }
          break;
        case EIP7702_ACTION_KIND.TRANSFER_ERC1155:
          if (
            isZeroAddress(action.asset) ||
            sameAddress(action.asset, value.sourceAddress) ||
            !transferCounterpartyMatches ||
            amount === 0n
          ) {
            context.addIssue({
              code: "custom",
              message: "ERC-1155 rescue action has an invalid fixed scope",
              path: ["actions", index],
            });
          }
          break;
        case EIP7702_ACTION_KIND.REVOKE_ERC20_APPROVAL:
        case EIP7702_ACTION_KIND.REVOKE_NFT_OPERATOR:
          if (
            isZeroAddress(action.asset) ||
            sameAddress(action.asset, value.sourceAddress) ||
            isZeroAddress(action.counterparty) ||
            tokenId !== 0n ||
            amount !== 0n
          ) {
            context.addIssue({
              code: "custom",
              message: "Approval revocation action has an invalid fixed scope",
              path: ["actions", index],
            });
          }
          break;
      }
    });
  });

export type Eip7702PackageAction = z.infer<typeof eip7702PackageActionSchema>;
export type Eip7702LocalSigningPackage = z.infer<
  typeof eip7702LocalSigningPackageSchema
>;

export function toRuntimeEip7702Actions(
  value: Pick<Eip7702LocalSigningPackage, "actions">,
): readonly Eip7702RescueAction[] {
  return value.actions.map(actionToAdapter);
}
