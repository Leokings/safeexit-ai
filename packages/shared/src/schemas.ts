import { z } from "zod";

import { chainIdSchema, evmAddressSchema } from "./validation";

const identifierSchema = z.string().min(1).max(256);
const timestampSchema = z.string().datetime({ offset: true });
const blockNumberSchema = z.string().regex(/^(0|[1-9]\d*)$/);
const baseUnitAmountSchema = z.string().regex(/^(0|[1-9]\d*)$/);
const transactionHashSchema = z.string().regex(/^0x[a-fA-F0-9]{64}$/);

export const supportStatusSchema = z.enum([
  "DETECTED",
  "SUPPORTED",
  "UNSUPPORTED",
  "UNKNOWN",
]);

export const incidentStatusSchema = z.enum([
  "RECEIVED",
  "WAITING_FOR_SOURCE",
  "ANALYSING",
  "PLAN_READY",
  "WAITING_FOR_USER",
  "SIGNING",
  "EXECUTING",
  "COMPLETED",
  "PARTIAL",
  "FAILED",
  "CANCELLED",
]);

export const assetValuationSchema = z.strictObject({
  estimatedValueUsd: z.number().finite().nonnegative(),
  source: z.string().min(1).max(128),
  observedAt: timestampSchema,
});

export const requestedNftAssetSchema = z.strictObject({
  collectionAddress: evmAddressSchema,
  tokenId: baseUnitAmountSchema,
});

export const rescueAssetManifestSchema = z
  .strictObject({
    erc20TokenAddresses: z.array(evmAddressSchema).max(8).default([]),
    erc721Assets: z.array(requestedNftAssetSchema).max(8).default([]),
    erc1155Assets: z.array(requestedNftAssetSchema).max(8).default([]),
  })
  .superRefine((manifest, context) => {
    const total =
      manifest.erc20TokenAddresses.length +
      manifest.erc721Assets.length +
      manifest.erc1155Assets.length;
    if (total === 0) {
      context.addIssue({
        code: "custom",
        message: "At least one asset contract must be supplied",
        path: ["erc20TokenAddresses"],
      });
    }
    if (total > 16) {
      context.addIssue({
        code: "custom",
        message: "A rescue incident may include at most 16 explicit assets",
        path: [],
      });
    }

    const seen = new Set<string>();
    const entries = [
      ...manifest.erc20TokenAddresses.map((address, index) => ({
        key: `erc20:${address.toLowerCase()}`,
        path: ["erc20TokenAddresses", index] as const,
      })),
      ...manifest.erc721Assets.map((asset, index) => ({
        key: `erc721:${asset.collectionAddress.toLowerCase()}:${asset.tokenId}`,
        path: ["erc721Assets", index] as const,
      })),
      ...manifest.erc1155Assets.map((asset, index) => ({
        key: `erc1155:${asset.collectionAddress.toLowerCase()}:${asset.tokenId}`,
        path: ["erc1155Assets", index] as const,
      })),
    ];
    for (const entry of entries) {
      if (seen.has(entry.key)) {
        context.addIssue({
          code: "custom",
          message: "Duplicate asset entry",
          path: [...entry.path],
        });
      }
      seen.add(entry.key);
    }
  });

const incidentShape = {
  id: identifierSchema,
  chainId: chainIdSchema,
  sourceAddress: evmAddressSchema,
  destinationAddress: evmAddressSchema,
  assetManifest: rescueAssetManifestSchema.optional(),
  status: incidentStatusSchema,
  ownershipAttestation: z.strictObject({
    accepted: z.literal(true),
    statementVersion: z.string().min(1).max(32),
    attestedAt: timestampSchema,
  }),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
} satisfies z.ZodRawShape;

export const incidentSchema = z
  .strictObject(incidentShape)
  .superRefine(({ sourceAddress, destinationAddress }, context) => {
    if (sourceAddress.toLowerCase() === destinationAddress.toLowerCase()) {
      context.addIssue({
        code: "custom",
        message: "Source and destination addresses must be different",
        path: ["destinationAddress"],
      });
    }
  });

const evidenceShape = {
  id: identifierSchema,
  chainId: chainIdSchema,
  ownerAddress: evmAddressSchema,
  supportStatus: supportStatusSchema,
  observedAtBlock: blockNumberSchema,
  discoverySource: z.string().min(1).max(128),
  confidence: z.number().min(0).max(1),
  valuation: assetValuationSchema.optional(),
} satisfies z.ZodRawShape;

export const nativeAssetSchema = z.strictObject({
  ...evidenceShape,
  assetType: z.literal("NATIVE"),
  symbol: z.string().min(1).max(32),
  decimals: z.number().int().min(0).max(255),
  balance: baseUnitAmountSchema,
});

export const erc20AssetSchema = z.strictObject({
  ...evidenceShape,
  assetType: z.literal("ERC20"),
  contractAddress: evmAddressSchema,
  name: z.string().min(1).max(128),
  symbol: z.string().min(1).max(32),
  decimals: z.number().int().min(0).max(255),
  balance: baseUnitAmountSchema,
});

export const erc721AssetSchema = z.strictObject({
  ...evidenceShape,
  assetType: z.literal("ERC721"),
  contractAddress: evmAddressSchema,
  tokenId: baseUnitAmountSchema,
  name: z.string().min(1).max(128).optional(),
});

export const erc1155AssetSchema = z.strictObject({
  ...evidenceShape,
  assetType: z.literal("ERC1155"),
  contractAddress: evmAddressSchema,
  tokenId: baseUnitAmountSchema,
  balance: baseUnitAmountSchema,
});

export const assetSchema = z.discriminatedUnion("assetType", [
  nativeAssetSchema,
  erc20AssetSchema,
  erc721AssetSchema,
  erc1155AssetSchema,
]);

const approvalEvidenceShape = {
  id: identifierSchema,
  chainId: chainIdSchema,
  ownerAddress: evmAddressSchema,
  supportStatus: supportStatusSchema,
  observedAtBlock: blockNumberSchema,
  discoverySource: z.string().min(1).max(128),
} satisfies z.ZodRawShape;

export const erc20ApprovalSchema = z.strictObject({
  ...approvalEvidenceShape,
  approvalType: z.literal("ERC20_ALLOWANCE"),
  tokenAddress: evmAddressSchema,
  spenderAddress: evmAddressSchema,
  amount: baseUnitAmountSchema,
});

export const erc721TokenApprovalSchema = z.strictObject({
  ...approvalEvidenceShape,
  approvalType: z.literal("ERC721_TOKEN"),
  collectionAddress: evmAddressSchema,
  operatorAddress: evmAddressSchema,
  tokenId: baseUnitAmountSchema,
});

export const nftOperatorApprovalSchema = z.strictObject({
  ...approvalEvidenceShape,
  approvalType: z.literal("NFT_OPERATOR"),
  standard: z.enum(["ERC721", "ERC1155"]),
  collectionAddress: evmAddressSchema,
  operatorAddress: evmAddressSchema,
  approved: z.boolean(),
});

export const approvalSchema = z.discriminatedUnion("approvalType", [
  erc20ApprovalSchema,
  erc721TokenApprovalSchema,
  nftOperatorApprovalSchema,
]);

export const walletScanSchema = z.strictObject({
  id: identifierSchema,
  incidentId: identifierSchema,
  chainId: chainIdSchema,
  address: evmAddressSchema,
  status: z.enum(["COMPLETE", "PARTIAL", "FAILED"]),
  providerId: z.string().min(1).max(128),
  observedAtBlock: blockNumberSchema,
  observedAt: timestampSchema,
  assets: z.array(assetSchema),
  approvals: z.array(approvalSchema),
  warnings: z.array(z.string().min(1).max(500)),
});

export const expectedEffectSchema = z.strictObject({
  effectType: z.enum([
    "BALANCE_INCREASE",
    "BALANCE_DECREASE",
    "ALLOWANCE_REVOKED",
    "ASSET_TRANSFERRED",
    "POSITION_CHANGED",
  ]),
  assetId: identifierSchema.optional(),
  description: z.string().min(1).max(500),
});

const actionCommonShape = {
  id: identifierSchema,
  chainId: chainIdSchema,
  sourceAddress: evmAddressSchema,
  dependencies: z.array(identifierSchema),
  evidenceIds: z.array(identifierSchema),
  expectedEffects: z.array(expectedEffectSchema),
  riskLevel: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
  estimatedValueUsd: z.number().finite().nonnegative().optional(),
  supportStatus: supportStatusSchema,
  simulationStatus: z.enum(["NOT_SIMULATED", "PASSED", "FAILED", "EXPIRED"]),
} satisfies z.ZodRawShape;

export const transferNativeActionSchema = z.strictObject({
  ...actionCommonShape,
  actionType: z.literal("TRANSFER_NATIVE"),
  parameters: z.strictObject({
    recipient: evmAddressSchema,
    maximumAmount: baseUnitAmountSchema,
    amountStrategy: z.literal("MAX_MINUS_GAS_RESERVE"),
  }),
});

export const transferErc20ActionSchema = z.strictObject({
  ...actionCommonShape,
  actionType: z.literal("TRANSFER_ERC20"),
  parameters: z.strictObject({
    tokenAddress: evmAddressSchema,
    recipient: evmAddressSchema,
    amount: baseUnitAmountSchema,
  }),
});

export const transferErc721ActionSchema = z.strictObject({
  ...actionCommonShape,
  actionType: z.literal("TRANSFER_ERC721"),
  parameters: z.strictObject({
    collectionAddress: evmAddressSchema,
    recipient: evmAddressSchema,
    tokenId: baseUnitAmountSchema,
  }),
});

export const transferErc1155ActionSchema = z.strictObject({
  ...actionCommonShape,
  actionType: z.literal("TRANSFER_ERC1155"),
  parameters: z.strictObject({
    collectionAddress: evmAddressSchema,
    recipient: evmAddressSchema,
    tokenId: baseUnitAmountSchema,
    amount: baseUnitAmountSchema,
  }),
});

export const revokeErc20ApprovalActionSchema = z.strictObject({
  ...actionCommonShape,
  actionType: z.literal("REVOKE_ERC20_APPROVAL"),
  parameters: z.strictObject({
    tokenAddress: evmAddressSchema,
    spenderAddress: evmAddressSchema,
  }),
});

export const revokeNftOperatorActionSchema = z.strictObject({
  ...actionCommonShape,
  actionType: z.literal("REVOKE_NFT_OPERATOR"),
  parameters: z.strictObject({
    standard: z.enum(["ERC721", "ERC1155"]),
    collectionAddress: evmAddressSchema,
    operatorAddress: evmAddressSchema,
  }),
});

export const claimSupportedAirdropActionSchema = z.strictObject({
  ...actionCommonShape,
  actionType: z.literal("CLAIM_SUPPORTED_AIRDROP"),
  parameters: z.strictObject({
    adapterId: identifierSchema,
    contractAddress: evmAddressSchema,
    claimReference: z.string().min(1).max(256),
  }),
});

export const withdrawSupportedPositionActionSchema = z.strictObject({
  ...actionCommonShape,
  actionType: z.literal("WITHDRAW_SUPPORTED_POSITION"),
  parameters: z.strictObject({
    adapterId: identifierSchema,
    contractAddress: evmAddressSchema,
    positionId: z.string().min(1).max(256),
  }),
});

export const customSupportedAdapterActionSchema = z.strictObject({
  ...actionCommonShape,
  actionType: z.literal("CUSTOM_SUPPORTED_ADAPTER"),
  parameters: z.strictObject({
    adapterId: identifierSchema,
    contractAddress: evmAddressSchema,
    operationId: z.string().min(1).max(256),
  }),
});

export const rescueActionSchema = z.discriminatedUnion("actionType", [
  transferNativeActionSchema,
  transferErc20ActionSchema,
  transferErc721ActionSchema,
  transferErc1155ActionSchema,
  revokeErc20ApprovalActionSchema,
  revokeNftOperatorActionSchema,
  claimSupportedAirdropActionSchema,
  withdrawSupportedPositionActionSchema,
  customSupportedAdapterActionSchema,
]);

export const planOmissionSchema = z.strictObject({
  evidenceId: identifierSchema,
  supportStatus: z.enum(["DETECTED", "UNSUPPORTED", "UNKNOWN"]),
  reason: z.string().min(1).max(500),
});

export const rescuePlanSchema = z
  .strictObject({
    id: identifierSchema,
    incidentId: identifierSchema,
    version: z.number().int().positive(),
    policyVersion: z.string().min(1).max(64),
    chainId: chainIdSchema,
    sourceAddress: evmAddressSchema,
    destinationAddress: evmAddressSchema,
    observedAtBlock: blockNumberSchema,
    status: z.enum(["DRAFT", "READY", "PARTIAL", "STALE", "COMPLETED"]),
    actions: z.array(rescueActionSchema),
    omissions: z.array(planOmissionSchema),
    integrityHash: transactionHashSchema,
    createdAt: timestampSchema,
  })
  .superRefine(({ sourceAddress, destinationAddress, actions }, context) => {
    if (sourceAddress.toLowerCase() === destinationAddress.toLowerCase()) {
      context.addIssue({
        code: "custom",
        message: "Source and destination addresses must be different",
        path: ["destinationAddress"],
      });
    }

    const actionIds = new Set(actions.map((action) => action.id));
    if (actionIds.size !== actions.length) {
      context.addIssue({
        code: "custom",
        message: "Rescue action IDs must be unique",
        path: ["actions"],
      });
    }

    const actionIndexes = new Map(
      actions.map((action, actionIndex) => [action.id, actionIndex]),
    );
    actions.forEach((action, actionIndex) => {
      action.dependencies.forEach((dependencyId, dependencyIndex) => {
        const dependencyActionIndex = actionIndexes.get(dependencyId);
        if (
          dependencyId === action.id ||
          dependencyActionIndex === undefined ||
          dependencyActionIndex >= actionIndex
        ) {
          context.addIssue({
            code: "custom",
            message: "Dependencies must reference an earlier action in the plan",
            path: ["actions", actionIndex, "dependencies", dependencyIndex],
          });
        }
      });
    });
  });

export const simulationResultSchema = z
  .strictObject({
    id: identifierSchema,
    planId: identifierSchema,
    actionId: identifierSchema,
    providerId: z.string().min(1).max(128),
    status: z.enum(["SUCCEEDED", "REVERTED", "UNSUPPORTED", "ERROR"]),
    planHash: transactionHashSchema,
    observedAtBlock: blockNumberSchema,
    gasEstimate: baseUnitAmountSchema.optional(),
    expectedEffects: z.array(expectedEffectSchema),
    assetChanges: z.array(
      z.discriminatedUnion("assetType", [
        z.strictObject({
          assetType: z.literal("NATIVE"),
          account: evmAddressSchema,
          direction: z.enum(["DEBIT", "CREDIT"]),
          amount: baseUnitAmountSchema,
        }),
        z.strictObject({
          assetType: z.literal("ERC20"),
          contractAddress: evmAddressSchema,
          account: evmAddressSchema,
          direction: z.enum(["DEBIT", "CREDIT"]),
          amount: baseUnitAmountSchema,
        }),
        z.strictObject({
          assetType: z.literal("ERC721"),
          contractAddress: evmAddressSchema,
          tokenId: baseUnitAmountSchema,
          account: evmAddressSchema,
          direction: z.enum(["DEBIT", "CREDIT"]),
          amount: z.literal("1"),
        }),
        z.strictObject({
          assetType: z.literal("ERC1155"),
          contractAddress: evmAddressSchema,
          tokenId: baseUnitAmountSchema,
          account: evmAddressSchema,
          direction: z.enum(["DEBIT", "CREDIT"]),
          amount: baseUnitAmountSchema,
        }),
      ]),
    ),
    warnings: z.array(z.string().min(1).max(500)),
    failureReason: z.string().min(1).max(1_000).optional(),
    simulatedAt: timestampSchema,
    expiresAt: timestampSchema,
  })
  .superRefine(({ status, failureReason }, context) => {
    if (status !== "SUCCEEDED" && !failureReason) {
      context.addIssue({
        code: "custom",
        message: "A non-successful simulation must include a failure reason",
        path: ["failureReason"],
      });
    }
  });

export const agentJobStatusSchema = incidentStatusSchema;

export const agentJobSchema = z.strictObject({
  id: identifierSchema,
  service: z.literal("safeexit-incident-response"),
  status: agentJobStatusSchema,
  incidentId: identifierSchema.optional(),
  dashboardUrl: z.string().url().optional(),
  resultSummary: z.string().min(1).max(2_000).optional(),
  errorCode: z.string().min(1).max(128).optional(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});

export type SupportStatus = z.infer<typeof supportStatusSchema>;
export type IncidentStatus = z.infer<typeof incidentStatusSchema>;
export type AssetValuation = z.infer<typeof assetValuationSchema>;
export type RequestedNftAsset = z.infer<typeof requestedNftAssetSchema>;
export type RescueAssetManifest = z.infer<typeof rescueAssetManifestSchema>;
export type Incident = z.infer<typeof incidentSchema>;
export type Asset = z.infer<typeof assetSchema>;
export type Approval = z.infer<typeof approvalSchema>;
export type WalletScan = z.infer<typeof walletScanSchema>;
export type ExpectedEffect = z.infer<typeof expectedEffectSchema>;
export type RescueAction = z.infer<typeof rescueActionSchema>;
export type PlanOmission = z.infer<typeof planOmissionSchema>;
export type RescuePlan = z.infer<typeof rescuePlanSchema>;
export type SimulationAssetChange = z.infer<
  typeof simulationResultSchema
>["assetChanges"][number];
export type SimulationResult = z.infer<typeof simulationResultSchema>;
export type AgentJobStatus = z.infer<typeof agentJobStatusSchema>;
export type AgentJob = z.infer<typeof agentJobSchema>;
