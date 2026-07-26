import { describe, expect, it } from "vitest";

import {
  getConfiguredPermitSettlementAddress,
  getConfiguredPermitSettlementRuntimeHash,
} from "@safeexit/adapters";
import { XLAYER_SAFEEXIT_EIP7702_FACTORY_V2 } from "@safeexit/buyer-runtime";
import { computePlanIntegrityHash } from "@safeexit/planner";
import {
  evmAddressSchema,
  type RescuePlan,
} from "@safeexit/shared";

import {
  eip7702RouteKey,
  gaslessRouteKey,
  mainnetPreflightResponseSchema,
  requireReviewedEip7702Route,
} from "./mainnet-rescue";
import { EIP7702_SIMULATION_PROVIDER_ID } from "./eip7702-constants";
import { assembleEip7702LocalSigningPackageFromPlan } from "./live-eip7702-signing-package-builder";

const source = evmAddressSchema.parse("0x1111111111111111111111111111111111111111");
const destination = evmAddressSchema.parse("0x2222222222222222222222222222222222222222");
const token = evmAddressSchema.parse("0x3333333333333333333333333333333333333333");
const replacementAddress = evmAddressSchema.parse(
  "0x4444444444444444444444444444444444444444",
);
const settlement = getConfiguredPermitSettlementAddress(196)!;
const observedAt = "2026-07-15T10:00:00.000Z";

function validPreflightResponse() {
  const action = {
    id: "action:transfer-token",
    chainId: 196,
    sourceAddress: source,
    dependencies: [],
    evidenceIds: [],
    expectedEffects: [{
      effectType: "ASSET_TRANSFERRED" as const,
      description: "Transfer the exact reviewed token balance",
    }],
    riskLevel: "CRITICAL" as const,
    supportStatus: "SUPPORTED" as const,
    simulationStatus: "NOT_SIMULATED" as const,
    actionType: "TRANSFER_ERC20" as const,
    parameters: {
      tokenAddress: token,
      recipient: destination,
      amount: "1250000",
    },
  };
  const planPayload: Omit<RescuePlan, "integrityHash"> = {
    id: "plan:test",
    incidentId: "incident:test",
    version: 1,
    policyVersion: "safeexit-x-layer-mainnet-v1",
    chainId: 196,
    sourceAddress: source,
    destinationAddress: destination,
    observedAtBlock: "100",
    status: "READY" as const,
    actions: [action],
    omissions: [],
    createdAt: observedAt,
  };
  const plan = {
    ...planPayload,
    integrityHash: computePlanIntegrityHash(planPayload),
  };
  return mainnetPreflightResponseSchema.parse({
    chainId: 196,
    scan: {
      id: "scan:test",
      incidentId: "incident:test",
      chainId: 196,
      address: source,
      status: "PARTIAL" as const,
      providerId: "x-layer-rpc",
      observedAtBlock: "100",
      observedAt,
      assets: [],
      approvals: [],
      warnings: ["Manifest-limited scan"],
    },
    plan,
    simulations: [{
      id: "simulation:test",
      planId: plan.id,
      actionId: action.id,
      providerId: "x-layer-rpc-preflight",
      status: "SUCCEEDED" as const,
      planHash: plan.integrityHash,
      observedAtBlock: plan.observedAtBlock,
      expectedEffects: action.expectedEffects,
      assetChanges: [],
      warnings: [],
      simulatedAt: observedAt,
      expiresAt: "2026-07-15T10:05:00.000Z",
    }],
    sourceFundedExecutionDisabled: true as const,
    gaslessActions: [{
      actionId: action.id,
      executionPath: "SAFEEXIT_SETTLEMENT" as const,
      authorizationStandard: "ERC2612" as const,
      standard: "ERC2612_PERMIT_SETTLEMENT" as const,
      capabilityStatus: "SIGNATURE_VERIFICATION_REQUIRED" as const,
      tokenAddress: token,
      from: source,
      to: destination,
      amount: action.parameters.amount,
      nonce: "7",
      domain: {
        name: "Rescue Token",
        version: "1",
        chainId: 196,
        verifyingContract: token,
      },
      settlementContract: settlement,
      requiredSignatures: 2 as const,
    }],
    blockedActions: [],
  });
}

function permitRoute(response: ReturnType<typeof validPreflightResponse>) {
  const route = response.gaslessActions[0];
  if (!route || route.standard !== "ERC2612_PERMIT_SETTLEMENT") {
    throw new Error("Expected ERC-2612 route fixture");
  }
  return route;
}

function validEip7702PreflightResponse() {
  const response = validPreflightResponse();
  const simulation = {
    ...response.simulations[0]!,
    providerId: EIP7702_SIMULATION_PROVIDER_ID,
  };
  const signingPackage = assembleEip7702LocalSigningPackageFromPlan({
    context: {
      jobId: "web:incident:test",
      incidentId: response.plan.incidentId,
      plan: response.plan,
      simulation: {
        status: "SUCCEEDED",
        providerId: EIP7702_SIMULATION_PROVIDER_ID,
        results: [simulation],
        executableActionIds: [response.plan.actions[0]!.id],
        excludedActionIds: [],
      },
    },
    factory: XLAYER_SAFEEXIT_EIP7702_FACTORY_V2,
    delegateAddress: "0x5555555555555555555555555555555555555555",
    sourceNonce: 0,
    rescueNonce: `0x${"66".repeat(32)}`,
    now: new Date(observedAt),
  });
  return mainnetPreflightResponseSchema.parse({
    ...response,
    simulations: [simulation],
    gaslessActions: [],
    eip7702Route: {
      executionPath: "SAFEEXIT_EIP7702",
      authorizationStandard: "EIP7702",
      capabilityStatus: "VERIFIED",
      signingPackage,
    },
    blockedActions: [],
  });
}

describe("mainnet rescue settlement adapters", () => {
  const deployments = [
    [1, "0x1183e94093ad7baf0606bef1755bd56930c1eec1d7a9db4102eac03663bb54cd"],
    [56, "0xd2c64850be4dcb4948925247b5b11be584f650cf0f5bf2402dbc690cbe4c12b1"],
    [137, "0x70baaa06eaac1bb6813d9317e4b04502bdea3a54c4791a5e9d01106458f346f5"],
    [42_161, "0xa5545da519187ecd09cb14d9f814ca467dd361d086775e4cbf8b3ff05c723611"],
    [10, "0xdd90cd4be84e1aedc9d16a9da8bdf6caa040dda8b2b9f312c433caf6be1ade55"],
    [8_453, "0x69ef1ca11c2d4a0bcd0defb53c988d31c1027c0b89afb9bc5317b533de97aa45"],
    [43_114, "0xc3cff642b325f9bef6408b3d17bc6dc4be3b75213eebe58b47e8dadf1ad78de8"],
    [196, "0x955c4b306894721c464f129075049c055ba9da3688cf5e538cf5eb90c0cbd3de"],
  ] as const;

  it.each(deployments)(
    "pins the verified settlement deployment for chain %i",
    (chainId, expectedRuntimeHash) => {
      expect(getConfiguredPermitSettlementAddress(chainId)).toBe(
        "0x73E8A8d165EC9710aC27f91B0Df02975CC4a48d0",
      );
      expect(getConfiguredPermitSettlementRuntimeHash(chainId)).toBe(
        expectedRuntimeHash,
      );
    },
  );

  it("fails closed for chains without a verified deployment", () => {
    expect(getConfiguredPermitSettlementAddress(31_337)).toBeUndefined();
    expect(getConfiguredPermitSettlementRuntimeHash(31_337)).toBeUndefined();
  });

  it("accepts a fully committed preflight response", () => {
    expect(mainnetPreflightResponseSchema.safeParse(validPreflightResponse()).success).toBe(true);
  });

  it.each([
    ["typed-data chain", (value: ReturnType<typeof validPreflightResponse>) => {
      permitRoute(value).domain.chainId = 1;
    }],
    ["settlement deployment", (value: ReturnType<typeof validPreflightResponse>) => {
      permitRoute(value).settlementContract = replacementAddress;
    }],
    ["source", (value: ReturnType<typeof validPreflightResponse>) => {
      permitRoute(value).from = replacementAddress;
    }],
    ["destination", (value: ReturnType<typeof validPreflightResponse>) => {
      permitRoute(value).to = replacementAddress;
    }],
    ["amount", (value: ReturnType<typeof validPreflightResponse>) => {
      permitRoute(value).amount = "1";
    }],
    ["simulation plan hash", (value: ReturnType<typeof validPreflightResponse>) => {
      value.simulations[0]!.planHash = `0x${"55".repeat(32)}`;
    }],
  ])("rejects a tampered %s commitment", (_name, mutate) => {
    const response = validPreflightResponse();
    mutate(response);
    expect(mainnetPreflightResponseSchema.safeParse(response).success).toBe(false);
  });

  it("rejects plan mutation even when route fields still look valid", () => {
    const response = validPreflightResponse();
    response.plan.actions[0]!.riskLevel = "LOW";
    expect(mainnetPreflightResponseSchema.safeParse(response).success).toBe(false);
  });

  it("keeps volatile action evidence out of the executable review fingerprint", () => {
    const first = permitRoute(validPreflightResponse());
    expect(gaslessRouteKey({ ...first, actionId: "action:other" })).toBe(gaslessRouteKey(first));
  });

  it("accepts a fully committed EIP-7702 route", () => {
    expect(
      mainnetPreflightResponseSchema.safeParse(validEip7702PreflightResponse()).success,
    ).toBe(true);
  });

  it.each([
    ["destination", (value: ReturnType<typeof validEip7702PreflightResponse>) => {
      value.eip7702Route!.signingPackage.destinationAddress = replacementAddress;
    }],
    ["delegated amount", (value: ReturnType<typeof validEip7702PreflightResponse>) => {
      value.eip7702Route!.signingPackage.actions[0]!.amount = "1";
    }],
    ["simulation result", (value: ReturnType<typeof validEip7702PreflightResponse>) => {
      value.eip7702Route!.signingPackage.simulation.resultIds[0] = "simulation:other";
    }],
  ])("rejects a tampered EIP-7702 %s commitment", (_name, mutate) => {
    const response = validEip7702PreflightResponse();
    mutate(response);
    expect(mainnetPreflightResponseSchema.safeParse(response).success).toBe(false);
  });

  it("keeps fresh authorization entropy and action evidence out of the EIP-7702 review fingerprint", () => {
    const route = validEip7702PreflightResponse().eip7702Route!;
    const refreshed = {
      ...route,
      signingPackage: {
        ...route.signingPackage,
        packageId: "eip7702-package:fresh",
        rescueNonce: `0x${"77".repeat(32)}`,
        delegateAddress: evmAddressSchema.parse(
          "0x7777777777777777777777777777777777777777",
        ),
        actionIds: ["action:fresh-evidence"],
      },
    };
    const reviewedKey = eip7702RouteKey(route);
    expect(eip7702RouteKey(refreshed)).toBe(reviewedKey);
    expect(requireReviewedEip7702Route(refreshed, reviewedKey)).toBe(refreshed);
  });

  it("rejects a changed EIP-7702 executable batch commitment", () => {
    const route = validEip7702PreflightResponse().eip7702Route!;
    const reviewedKey = eip7702RouteKey(route);
    const changed = {
      ...route,
      signingPackage: {
        ...route.signingPackage,
        delegatePlanHash: `0x${"88".repeat(32)}` as const,
      },
    };

    expect(() => requireReviewedEip7702Route(changed, reviewedKey)).toThrow(
      "The selected recovery route changed during fresh preflight",
    );
  });
});
