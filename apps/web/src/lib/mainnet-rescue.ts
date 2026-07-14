import { z } from "zod";

import {
  evmAddressSchema,
  chainIdSchema,
  rescuePlanSchema,
  simulationResultSchema,
  walletScanSchema,
} from "@safeexit/shared";
import { isRescueMainnetChainId } from "@safeexit/chain";

export const rescueMainnetChainIdSchema = chainIdSchema.refine(
  isRescueMainnetChainId,
  "Chain is not enabled for mainnet rescue",
);

const requestedNftSchema = z.strictObject({
  collectionAddress: evmAddressSchema,
  tokenId: z.string().regex(/^(0|[1-9]\d*)$/),
});

export const mainnetPreflightRequestSchema = z
  .strictObject({
    tokenAddresses: z.array(evmAddressSchema).max(8),
    erc721Assets: z.array(requestedNftSchema).max(8).default([]),
    erc1155Assets: z.array(requestedNftSchema).max(8).default([]),
  })
  .superRefine((request, context) => {
    const total =
      request.tokenAddresses.length +
      request.erc721Assets.length +
      request.erc1155Assets.length;
    if (total === 0) {
      context.addIssue({
        code: "custom",
        message: "At least one asset must be supplied for preflight",
        path: ["tokenAddresses"],
      });
    }
    if (total > 16) {
      context.addIssue({
        code: "custom",
        message: "A preflight may include at most 16 assets",
        path: [],
      });
    }
  });

export const eip712DomainSchema = z.strictObject({
  name: z.string().min(1).max(128),
  version: z.string().min(1).max(32),
  chainId: rescueMainnetChainIdSchema,
  verifyingContract: evmAddressSchema,
});

export const eip3009RescueActionSchema = z.strictObject({
  actionId: z.string().min(1).max(256),
  standard: z.literal("ERC3009_RECEIVE_WITH_AUTHORIZATION"),
  capabilityStatus: z.literal("VERIFIED"),
  tokenAddress: evmAddressSchema,
  from: evmAddressSchema,
  to: evmAddressSchema,
  amount: z.string().regex(/^(0|[1-9]\d*)$/),
  domain: eip712DomainSchema,
});

export const erc2612RescueActionSchema = z.strictObject({
  actionId: z.string().min(1).max(256),
  standard: z.literal("ERC2612_PERMIT_ATOMIC_BATCH"),
  capabilityStatus: z.literal("SIGNATURE_VERIFICATION_REQUIRED"),
  tokenAddress: evmAddressSchema,
  from: evmAddressSchema,
  to: evmAddressSchema,
  amount: z.string().regex(/^(0|[1-9]\d*)$/),
  nonce: z.string().regex(/^(0|[1-9]\d*)$/),
  domain: eip712DomainSchema,
  requiredWalletCapability: z.literal("ATOMIC_BATCH"),
});

export const daiPermitRescueActionSchema = z.strictObject({
  actionId: z.string().min(1).max(256),
  standard: z.literal("DAI_PERMIT_ATOMIC_BATCH"),
  capabilityStatus: z.literal("SIGNATURE_VERIFICATION_REQUIRED"),
  tokenAddress: evmAddressSchema,
  from: evmAddressSchema,
  to: evmAddressSchema,
  amount: z.string().regex(/^(0|[1-9]\d*)$/),
  nonce: z.string().regex(/^(0|[1-9]\d*)$/),
  domain: eip712DomainSchema,
  requiredWalletCapability: z.literal("ATOMIC_BATCH"),
  requiredSignatures: z.literal(2),
});

export const erc4494RescueActionSchema = z.strictObject({
  actionId: z.string().min(1).max(256),
  standard: z.literal("ERC4494_PERMIT_ATOMIC_BATCH"),
  capabilityStatus: z.literal("SIGNATURE_VERIFICATION_REQUIRED"),
  collectionAddress: evmAddressSchema,
  from: evmAddressSchema,
  to: evmAddressSchema,
  tokenId: z.string().regex(/^(0|[1-9]\d*)$/),
  nonce: z.string().regex(/^(0|[1-9]\d*)$/),
  domain: eip712DomainSchema,
  requiredWalletCapability: z.literal("ATOMIC_BATCH"),
});

export const gaslessRescueActionSchema = z.discriminatedUnion("standard", [
  eip3009RescueActionSchema,
  erc2612RescueActionSchema,
  daiPermitRescueActionSchema,
  erc4494RescueActionSchema,
]);

export const blockedGaslessActionSchema = z.strictObject({
  actionId: z.string().min(1).max(256),
  reason: z.string().min(1).max(500),
});

export const mainnetPreflightResponseSchema = z.strictObject({
  chainId: rescueMainnetChainIdSchema,
  scan: walletScanSchema,
  plan: rescuePlanSchema,
  simulations: z.array(simulationResultSchema),
  sourceFundedExecutionDisabled: z.literal(true),
  gaslessActions: z.array(gaslessRescueActionSchema),
  blockedActions: z.array(blockedGaslessActionSchema),
}).superRefine((response, context) => {
  if (
    response.scan.chainId !== response.chainId ||
    response.plan.chainId !== response.chainId
  ) {
    context.addIssue({
      code: "custom",
      message: "Preflight chain commitments do not match",
      path: ["chainId"],
    });
  }
});

export type MainnetPreflightRequest = z.infer<typeof mainnetPreflightRequestSchema>;
export type MainnetPreflightResponse = z.infer<typeof mainnetPreflightResponseSchema>;
export type Eip712Domain = z.infer<typeof eip712DomainSchema>;
export type GaslessRescueAction = z.infer<typeof gaslessRescueActionSchema>;
export type Eip3009RescueAction = z.infer<typeof eip3009RescueActionSchema>;
export type Erc2612RescueAction = z.infer<typeof erc2612RescueActionSchema>;
export type DaiPermitRescueAction = z.infer<typeof daiPermitRescueActionSchema>;
export type Erc4494RescueAction = z.infer<typeof erc4494RescueActionSchema>;

function routeDomainCommitment(route: GaslessRescueAction) {
  return {
    name: route.domain.name,
    version: route.domain.version,
    chainId: route.domain.chainId,
    verifyingContract: route.domain.verifyingContract.toLowerCase(),
  };
}

export function gaslessRouteKey(route: GaslessRescueAction): string {
  const common = {
    standard: route.standard,
    from: route.from.toLowerCase(),
    to: route.to.toLowerCase(),
    domain: routeDomainCommitment(route),
  };

  if (route.standard === "ERC4494_PERMIT_ATOMIC_BATCH") {
    return JSON.stringify({
      ...common,
      collectionAddress: route.collectionAddress.toLowerCase(),
      tokenId: route.tokenId,
      nonce: route.nonce,
    });
  }

  return JSON.stringify({
    ...common,
    tokenAddress: route.tokenAddress.toLowerCase(),
    amount: route.amount,
    ...("nonce" in route ? { nonce: route.nonce } : {}),
  });
}

export function requireReviewedGaslessRoute(
  routes: readonly GaslessRescueAction[],
  reviewedRouteKey: string,
): GaslessRescueAction {
  const route = routes.find((candidate) => gaslessRouteKey(candidate) === reviewedRouteKey);
  if (!route) {
    throw new Error(
      "The selected recovery route changed during fresh preflight. Review the new result before signing.",
    );
  }
  return route;
}
