import { z } from "zod";

import {
  evmAddressSchema,
  chainIdSchema,
  rescuePlanSchema,
  simulationResultSchema,
  walletScanSchema,
} from "@safeexit/shared";
import { getConfiguredPermitSettlementAddress } from "@safeexit/adapters";
import { isRescueMainnetChainId } from "@safeexit/chain";
import { verifyPlanIntegrity } from "@safeexit/planner";

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
  executionPath: z.literal("DIRECT_AUTHORIZATION"),
  authorizationStandard: z.literal("ERC3009"),
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
  executionPath: z.literal("SAFEEXIT_SETTLEMENT"),
  authorizationStandard: z.literal("ERC2612"),
  standard: z.literal("ERC2612_PERMIT_SETTLEMENT"),
  capabilityStatus: z.literal("SIGNATURE_VERIFICATION_REQUIRED"),
  tokenAddress: evmAddressSchema,
  from: evmAddressSchema,
  to: evmAddressSchema,
  amount: z.string().regex(/^(0|[1-9]\d*)$/),
  nonce: z.string().regex(/^(0|[1-9]\d*)$/),
  domain: eip712DomainSchema,
  settlementContract: evmAddressSchema,
  requiredSignatures: z.literal(2),
});

export const daiPermitRescueActionSchema = z.strictObject({
  actionId: z.string().min(1).max(256),
  executionPath: z.literal("SAFEEXIT_SETTLEMENT"),
  authorizationStandard: z.literal("DAI_PERMIT"),
  standard: z.literal("DAI_PERMIT_SETTLEMENT"),
  capabilityStatus: z.literal("SIGNATURE_VERIFICATION_REQUIRED"),
  tokenAddress: evmAddressSchema,
  from: evmAddressSchema,
  to: evmAddressSchema,
  amount: z.string().regex(/^(0|[1-9]\d*)$/),
  nonce: z.string().regex(/^(0|[1-9]\d*)$/),
  domain: eip712DomainSchema,
  settlementContract: evmAddressSchema,
  requiredSignatures: z.literal(3),
});

export const erc4494RescueActionSchema = z.strictObject({
  actionId: z.string().min(1).max(256),
  executionPath: z.literal("SAFEEXIT_SETTLEMENT"),
  authorizationStandard: z.literal("ERC4494"),
  standard: z.literal("ERC4494_PERMIT_SETTLEMENT"),
  capabilityStatus: z.literal("SIGNATURE_VERIFICATION_REQUIRED"),
  collectionAddress: evmAddressSchema,
  from: evmAddressSchema,
  to: evmAddressSchema,
  tokenId: z.string().regex(/^(0|[1-9]\d*)$/),
  nonce: z.string().regex(/^(0|[1-9]\d*)$/),
  domain: eip712DomainSchema,
  settlementContract: evmAddressSchema,
  requiredSignatures: z.literal(2),
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
  const sameAddress = (left: string, right: string) =>
    left.toLowerCase() === right.toLowerCase();
  const addIssue = (message: string, path: PropertyKey[]) => {
    context.addIssue({
      code: "custom",
      message,
      path,
    });
  };

  if (response.scan.chainId !== response.chainId || response.plan.chainId !== response.chainId) {
    addIssue("Preflight chain commitments do not match", ["chainId"]);
  }
  if (
    response.scan.incidentId !== response.plan.incidentId ||
    response.scan.observedAtBlock !== response.plan.observedAtBlock ||
    !sameAddress(response.scan.address, response.plan.sourceAddress)
  ) {
    addIssue("Scan commitments do not match the rescue plan", ["scan"]);
  }
  if (!verifyPlanIntegrity(response.plan)) {
    addIssue("Rescue plan integrity verification failed", ["plan", "integrityHash"]);
  }
  if (
    response.scan.status === "FAILED" ||
    (response.plan.status !== "READY" && response.plan.status !== "PARTIAL")
  ) {
    addIssue("Preflight is not in an executable planning state", ["plan", "status"]);
  }

  const planActions = new Map(response.plan.actions.map((action) => [action.id, action]));
  response.plan.actions.forEach((action, actionIndex) => {
    if (
      action.chainId !== response.chainId ||
      !sameAddress(action.sourceAddress, response.plan.sourceAddress)
    ) {
      addIssue("Rescue action commitments do not match the plan", ["plan", "actions", actionIndex]);
    }
  });

  const successfulSimulationActionIds = new Set<string>();
  const simulationActionIds = new Set<string>();
  response.simulations.forEach((simulation, simulationIndex) => {
    if (
      simulation.planId !== response.plan.id ||
      simulation.planHash.toLowerCase() !== response.plan.integrityHash.toLowerCase() ||
      simulation.observedAtBlock !== response.plan.observedAtBlock ||
      !planActions.has(simulation.actionId) ||
      simulationActionIds.has(simulation.actionId)
    ) {
      addIssue(
        "Simulation commitments do not match exactly one rescue-plan action",
        ["simulations", simulationIndex],
      );
    }
    simulationActionIds.add(simulation.actionId);
    if (simulation.status === "SUCCEEDED") {
      successfulSimulationActionIds.add(simulation.actionId);
    }
  });

  const routedActionIds = new Set<string>();
  response.gaslessActions.forEach((route, routeIndex) => {
    const path = ["gaslessActions", routeIndex] as PropertyKey[];
    const action = planActions.get(route.actionId);
    if (!action) {
      addIssue("Recovery route references an unknown rescue action", path);
      return;
    }
    routedActionIds.add(route.actionId);

    if (
      route.domain.chainId !== response.chainId ||
      !sameAddress(route.from, response.plan.sourceAddress) ||
      !sameAddress(route.to, response.plan.destinationAddress) ||
      action.supportStatus !== "SUPPORTED" ||
      !successfulSimulationActionIds.has(route.actionId)
    ) {
      addIssue("Recovery route does not match the reviewed plan and simulation", path);
    }

    if (route.standard === "ERC4494_PERMIT_SETTLEMENT") {
      if (
        action.actionType !== "TRANSFER_ERC721" ||
        !sameAddress(route.collectionAddress, action.parameters.collectionAddress) ||
        !sameAddress(route.to, action.parameters.recipient) ||
        route.tokenId !== action.parameters.tokenId ||
        !sameAddress(route.domain.verifyingContract, route.collectionAddress)
      ) {
        addIssue("NFT permit route does not match its rescue action", path);
      }
    } else if (
      action.actionType !== "TRANSFER_ERC20" ||
      !sameAddress(route.tokenAddress, action.parameters.tokenAddress) ||
      !sameAddress(route.to, action.parameters.recipient) ||
      route.amount !== action.parameters.amount ||
      !sameAddress(route.domain.verifyingContract, route.tokenAddress)
    ) {
      addIssue("ERC-20 authorization route does not match its rescue action", path);
    }

    if (route.standard !== "ERC3009_RECEIVE_WITH_AUTHORIZATION") {
      const configuredSettlement = getConfiguredPermitSettlementAddress(response.chainId);
      if (
        !configuredSettlement ||
        !sameAddress(route.settlementContract, configuredSettlement)
      ) {
        addIssue("Recovery route does not use the configured SafeExit settlement deployment", path);
      }
    }
  });

  const blockedActionIds = new Set<string>();
  response.blockedActions.forEach((blocked, blockedIndex) => {
    if (
      !planActions.has(blocked.actionId) ||
      blockedActionIds.has(blocked.actionId) ||
      routedActionIds.has(blocked.actionId)
    ) {
      addIssue(
        "Blocked action must reference one unrouted rescue-plan action",
        ["blockedActions", blockedIndex],
      );
    }
    blockedActionIds.add(blocked.actionId);
  });

  response.plan.actions.forEach((action, actionIndex) => {
    if (!simulationActionIds.has(action.id)) {
      addIssue("Every rescue action requires a matching simulation", ["plan", "actions", actionIndex]);
    }
    if (!routedActionIds.has(action.id) && !blockedActionIds.has(action.id)) {
      addIssue(
        "Every rescue action must be represented as recoverable or blocked",
        ["plan", "actions", actionIndex],
      );
    }
  });
  for (const actionId of successfulSimulationActionIds) {
    if (!routedActionIds.has(actionId) && !blockedActionIds.has(actionId)) {
      addIssue("Successful simulated action has no recovery disposition", ["simulations"]);
    }
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
    ...(route.standard === "ERC3009_RECEIVE_WITH_AUTHORIZATION"
      ? {}
      : { settlementContract: route.settlementContract.toLowerCase() }),
  };

  if (route.standard === "ERC4494_PERMIT_SETTLEMENT") {
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
