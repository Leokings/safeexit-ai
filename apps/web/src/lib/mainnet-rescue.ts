import { z } from "zod";

import {
  evmAddressSchema,
  chainIdSchema,
  rescuePlanSchema,
  simulationResultSchema,
  walletScanSchema,
} from "@safeexit/shared";
import {
  getConfiguredPermitSettlementAddress,
  toEip7702RescueActions,
} from "@safeexit/adapters";
import { eip7702LocalSigningPackageSchema } from "@safeexit/agent-service";
import { isRescueMainnetChainId } from "@safeexit/chain";
import { verifyPlanIntegrity } from "@safeexit/planner";

import { EIP7702_SIMULATION_PROVIDER_ID } from "./eip7702-constants";

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

export const eip7702RescueRouteSchema = z.strictObject({
  executionPath: z.literal("SAFEEXIT_EIP7702"),
  authorizationStandard: z.literal("EIP7702"),
  capabilityStatus: z.literal("VERIFIED"),
  signingPackage: eip7702LocalSigningPackageSchema,
});

export const mainnetPreflightResponseSchema = z.strictObject({
  chainId: rescueMainnetChainIdSchema,
  scan: walletScanSchema,
  plan: rescuePlanSchema,
  simulations: z.array(simulationResultSchema),
  sourceFundedExecutionDisabled: z.literal(true),
  gaslessActions: z.array(gaslessRescueActionSchema),
  eip7702Route: eip7702RescueRouteSchema.optional(),
  eip7702UnavailableReason: z.string().min(1).max(500).optional(),
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

  const eip7702Package = response.eip7702Route?.signingPackage;
  if (eip7702Package) {
    const path = ["eip7702Route", "signingPackage"] as PropertyKey[];
    if (
      response.chainId !== 196 ||
      eip7702Package.chainId !== response.chainId ||
      eip7702Package.planId !== response.plan.id ||
      eip7702Package.planHash.toLowerCase() !== response.plan.integrityHash.toLowerCase() ||
      eip7702Package.incidentId !== response.plan.incidentId ||
      eip7702Package.observedAtBlock !== response.plan.observedAtBlock ||
      !sameAddress(eip7702Package.sourceAddress, response.plan.sourceAddress) ||
      !sameAddress(eip7702Package.destinationAddress, response.plan.destinationAddress) ||
      eip7702Package.simulation.providerId !== EIP7702_SIMULATION_PROVIDER_ID
    ) {
      addIssue("EIP-7702 package commitments do not match the reviewed preflight", path);
    }

    const selectedPlanActions = eip7702Package.actionIds.flatMap((actionId, actionIndex) => {
      const action = planActions.get(actionId);
      if (
        !action ||
        action.supportStatus !== "SUPPORTED" ||
        !successfulSimulationActionIds.has(actionId)
      ) {
        addIssue(
          "EIP-7702 route must reference one supported, successfully simulated action",
          [...path, "actionIds", actionIndex],
        );
        return [];
      }
      const simulation = response.simulations.find(
        (candidate) => candidate.actionId === actionId,
      );
      if (eip7702Package.simulation.resultIds[actionIndex] !== simulation?.id) {
        addIssue(
          "EIP-7702 route simulation commitment does not match its rescue action",
          [...path, "simulation", "resultIds", actionIndex],
        );
      }
      routedActionIds.add(actionId);
      return [{
        ...action,
        simulationStatus: "PASSED" as const,
      }];
    });

    try {
      const expectedActions = toEip7702RescueActions(
        selectedPlanActions,
        response.plan.sourceAddress,
        response.plan.destinationAddress,
      );
      if (
        expectedActions.length !== eip7702Package.actions.length ||
        eip7702Package.executionIndexes.length !== expectedActions.length
      ) {
        addIssue("EIP-7702 package does not execute every committed rescue action", path);
      }
      expectedActions.forEach((expected, actionIndex) => {
        const packaged = eip7702Package.actions[actionIndex];
        if (
          !packaged ||
          packaged.kind !== expected.kind ||
          !sameAddress(packaged.asset, expected.asset) ||
          !sameAddress(packaged.counterparty, expected.counterparty) ||
          packaged.tokenId !== expected.tokenId.toString() ||
          packaged.amount !== expected.amount.toString() ||
          eip7702Package.executionIndexes[actionIndex] !== actionIndex
        ) {
          addIssue(
            "EIP-7702 delegated call does not match its rescue-plan action",
            [...path, "actions", actionIndex],
          );
        }
      });
    } catch {
      addIssue("EIP-7702 package contains an unsupported rescue action", path);
    }
  }

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
export type Eip7702RescueRoute = z.infer<typeof eip7702RescueRouteSchema>;
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

export function eip7702RouteKey(route: Eip7702RescueRoute): string {
  const signingPackage = route.signingPackage;
  return JSON.stringify({
    executionPath: route.executionPath,
    chainId: signingPackage.chainId,
    sourceAddress: signingPackage.sourceAddress.toLowerCase(),
    destinationAddress: signingPackage.destinationAddress.toLowerCase(),
    factoryAddress: signingPackage.factoryAddress.toLowerCase(),
    factoryRuntimeHash: signingPackage.factoryRuntimeHash.toLowerCase(),
    delegatePlanHash: signingPackage.delegatePlanHash.toLowerCase(),
  });
}

export function requireReviewedEip7702Route(
  route: Eip7702RescueRoute | undefined,
  reviewedRouteKey: string,
): Eip7702RescueRoute {
  if (!route || eip7702RouteKey(route) !== reviewedRouteKey) {
    throw new Error(
      "The selected recovery route changed during fresh preflight. Review the new result before signing.",
    );
  }
  return route;
}
