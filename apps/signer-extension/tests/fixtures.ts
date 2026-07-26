import {
  EIP7702_ACTION_KIND,
  eip7702RescueActionSchema,
  hashEip7702RescuePlan,
} from "@safeexit/adapters/eip7702-rescue";
import { eip7702LocalSigningPackageSchema } from "@safeexit/agent-service/eip7702-signing-package";
import { XLAYER_SAFEEXIT_EIP7702_FACTORY_V2 } from "@safeexit/buyer-runtime/eip7702-trust";

export const sourceAddress =
  "0x1000000000000000000000000000000000000001";
export const destinationAddress =
  "0x2000000000000000000000000000000000000002";
export const delegateAddress =
  "0x3000000000000000000000000000000000000003";
export const tokenAddress =
  "0x4000000000000000000000000000000000000004";
export const now = new Date("2026-07-25T10:00:00.000Z");
export const expiresAt = "2026-07-25T10:10:00.000Z";

export function signingPackageFixture() {
  const actions = [
    {
      kind: EIP7702_ACTION_KIND.TRANSFER_ERC20,
      asset: tokenAddress,
      counterparty: destinationAddress,
      tokenId: "0",
      amount: "1000000",
    },
  ] as const;
  const delegatePlanHash = hashEip7702RescuePlan(
    actions.map((action) => eip7702RescueActionSchema.parse({
      ...action,
      tokenId: BigInt(action.tokenId),
      amount: BigInt(action.amount),
    })),
  );

  return eip7702LocalSigningPackageSchema.parse({
    schemaVersion: "safeexit-eip7702-signing-package-v1",
    packageId: "package:extension:test",
    jobId: "job:extension:test",
    incidentId: "incident:extension:test",
    planId: "plan:extension:test",
    planHash: `0x${"11".repeat(32)}`,
    delegatePlanHash,
    route: "EIP7702_DELEGATED_RESCUE",
    chainId: 196,
    sourceAddress,
    destinationAddress,
    observedAtBlock: "100",
    expiresAt,
    deadline: Math.floor(Date.parse(expiresAt) / 1_000),
    sourceNonce: 7,
    rescueNonce: `0x${"22".repeat(32)}`,
    factoryAddress: XLAYER_SAFEEXIT_EIP7702_FACTORY_V2.address,
    factoryRuntimeHash: XLAYER_SAFEEXIT_EIP7702_FACTORY_V2.runtimeHash,
    delegateAddress,
    actionIds: ["action:erc20"],
    actions,
    executionIndexes: [0],
    simulation: {
      resultIds: ["simulation:erc20"],
      providerId: "xlayer-preflight",
      status: "SUCCEEDED",
      expiresAt: "2026-07-25T10:11:00.000Z",
    },
    policy: {
      sourceSignsLocally: true,
      destinationPaysAllGas: true,
      privateCredentialsAccepted: false,
      authorizationsReturnedToSafeExit: false,
      arbitraryCallsAllowed: false,
      postAuthorizationSimulationRequired: true,
      delegationClearRequired: true,
    },
  });
}
