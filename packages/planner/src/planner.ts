import {
  rescuePlanSchema,
  validateIncidentAddresses,
  type Approval,
  type Asset,
  type PlanOmission,
  type RescueAction,
  type RescuePlan,
} from "@safeexit/shared";

import { computePlanIntegrityHash, deepFreezePlan } from "./integrity";
import {
  rescuePlanningRequestSchema,
  trustedAdapterConfigSchema,
  type AdapterOutput,
  type ParsedRescuePlanningRequest,
  type RescuePlanningRequest,
  type SupportedAdapterCandidate,
  type TrustedAdapterConfig,
  type TrustedAdapterConfigInput,
} from "./schemas";

type RiskLevel = RescueAction["riskLevel"];
type ActionPriority = {
  risk: number;
  value: number;
  type: number;
};

const riskRank: Record<RiskLevel, number> = {
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
  CRITICAL: 4,
};

const actionTypeRank: Record<RescueAction["actionType"], number> = {
  CLAIM_SUPPORTED_AIRDROP: 90,
  WITHDRAW_SUPPORTED_POSITION: 85,
  CUSTOM_SUPPORTED_ADAPTER: 80,
  TRANSFER_ERC20: 70,
  TRANSFER_ERC721: 70,
  TRANSFER_ERC1155: 70,
  REVOKE_ERC20_APPROVAL: 30,
  REVOKE_NFT_OPERATOR: 30,
  TRANSFER_NATIVE: 0,
};

function riskForValue(estimatedValueUsd: number | undefined): RiskLevel {
  if (estimatedValueUsd === undefined) {
    return "MEDIUM";
  }
  if (estimatedValueUsd >= 10_000) {
    return "CRITICAL";
  }
  if (estimatedValueUsd >= 1_000) {
    return "HIGH";
  }
  if (estimatedValueUsd >= 100) {
    return "MEDIUM";
  }
  return "LOW";
}

function priorityFor(action: RescueAction): ActionPriority {
  return {
    risk: riskRank[action.riskLevel],
    value: action.estimatedValueUsd ?? 0,
    type: actionTypeRank[action.actionType],
  };
}

function compareActions(
  left: RescueAction,
  right: RescueAction,
  priorities: ReadonlyMap<string, ActionPriority>,
): number {
  const leftPriority = priorities.get(left.id) ?? priorityFor(left);
  const rightPriority = priorities.get(right.id) ?? priorityFor(right);

  return (
    rightPriority.risk - leftPriority.risk ||
    rightPriority.value - leftPriority.value ||
    rightPriority.type - leftPriority.type ||
    left.id.localeCompare(right.id)
  );
}

function topologicalPrioritySort(
  actions: readonly RescueAction[],
  priorities: ReadonlyMap<string, ActionPriority>,
): RescueAction[] {
  const remaining = new Map(actions.map((action) => [action.id, action]));
  const completed = new Set<string>();
  const ordered: RescueAction[] = [];

  while (remaining.size > 0) {
    const ready = [...remaining.values()]
      .filter((action) => action.dependencies.every((dependency) => completed.has(dependency)))
      .sort((left, right) => compareActions(left, right, priorities));
    const next = ready[0];

    if (!next) {
      throw new Error("Rescue action dependencies contain a cycle");
    }

    ordered.push(next);
    completed.add(next.id);
    remaining.delete(next.id);
  }

  return ordered;
}

function omissionForUnsupportedEvidence(
  evidence: Asset | Approval,
  reason: string,
): PlanOmission {
  return {
    evidenceId: evidence.id,
    supportStatus:
      evidence.supportStatus === "SUPPORTED" ? "UNSUPPORTED" : evidence.supportStatus,
    reason,
  };
}

function transferActionForAsset(
  asset: Exclude<Asset, { assetType: "NATIVE" }>,
  destinationAddress: ParsedRescuePlanningRequest["destinationAddress"],
): RescueAction {
  const estimatedValueUsd = asset.valuation?.estimatedValueUsd;
  const common = {
    id: `action:transfer:${asset.id}`,
    chainId: asset.chainId,
    sourceAddress: asset.ownerAddress,
    dependencies: [],
    evidenceIds: [asset.id],
    expectedEffects: [
      {
        effectType: "ASSET_TRANSFERRED" as const,
        assetId: asset.id,
        description: "Move the detected asset to the confirmed destination wallet.",
      },
    ],
    riskLevel: riskForValue(estimatedValueUsd),
    ...(estimatedValueUsd !== undefined ? { estimatedValueUsd } : {}),
    supportStatus: "SUPPORTED" as const,
    simulationStatus: "NOT_SIMULATED" as const,
  };

  switch (asset.assetType) {
    case "ERC20":
      return {
        ...common,
        actionType: "TRANSFER_ERC20",
        parameters: {
          tokenAddress: asset.contractAddress,
          recipient: destinationAddress,
          amount: asset.balance,
        },
      };
    case "ERC721":
      return {
        ...common,
        actionType: "TRANSFER_ERC721",
        parameters: {
          collectionAddress: asset.contractAddress,
          recipient: destinationAddress,
          tokenId: asset.tokenId,
        },
      };
    case "ERC1155":
      return {
        ...common,
        actionType: "TRANSFER_ERC1155",
        parameters: {
          collectionAddress: asset.contractAddress,
          recipient: destinationAddress,
          tokenId: asset.tokenId,
          amount: asset.balance,
        },
      };
  }
}

function adapterAction(candidate: SupportedAdapterCandidate): RescueAction {
  const common = {
    id: `action:adapter:${candidate.id}`,
    chainId: candidate.chainId,
    sourceAddress: candidate.sourceAddress,
    dependencies: [],
    evidenceIds: [candidate.evidenceId],
    expectedEffects:
      candidate.expectedEffects.length > 0
        ? candidate.expectedEffects
        : [
            {
              effectType: "POSITION_CHANGED" as const,
              description: candidate.description,
            },
          ],
    riskLevel: candidate.riskLevel,
    ...(candidate.estimatedValueUsd !== undefined
      ? { estimatedValueUsd: candidate.estimatedValueUsd }
      : {}),
    supportStatus: "SUPPORTED" as const,
    simulationStatus: "NOT_SIMULATED" as const,
  };

  switch (candidate.actionType) {
    case "CLAIM_SUPPORTED_AIRDROP":
      return {
        ...common,
        actionType: "CLAIM_SUPPORTED_AIRDROP",
        parameters: {
          adapterId: candidate.adapterId,
          contractAddress: candidate.contractAddress,
          claimReference: candidate.claimReference,
        },
      };
    case "WITHDRAW_SUPPORTED_POSITION":
      return {
        ...common,
        actionType: "WITHDRAW_SUPPORTED_POSITION",
        parameters: {
          adapterId: candidate.adapterId,
          contractAddress: candidate.contractAddress,
          positionId: candidate.positionId,
        },
      };
    case "CUSTOM_SUPPORTED_ADAPTER":
      return {
        ...common,
        actionType: "CUSTOM_SUPPORTED_ADAPTER",
        parameters: {
          adapterId: candidate.adapterId,
          contractAddress: candidate.contractAddress,
          operationId: candidate.operationId,
        },
      };
  }
}

function transferActionForAdapterOutput(
  candidate: SupportedAdapterCandidate,
  output: AdapterOutput,
  destinationAddress: ParsedRescuePlanningRequest["destinationAddress"],
  dependencyId: string,
): RescueAction {
  const common = {
    id: `action:adapter-output:${candidate.id}:${output.id}`,
    chainId: candidate.chainId,
    sourceAddress: candidate.sourceAddress,
    dependencies: [dependencyId],
    evidenceIds: [candidate.evidenceId, output.id],
    expectedEffects: [
      {
        effectType: "ASSET_TRANSFERRED" as const,
        assetId: output.id,
        description: "Move the verified adapter output to the confirmed destination.",
      },
    ],
    riskLevel: riskForValue(output.estimatedValueUsd ?? candidate.estimatedValueUsd),
    ...(output.estimatedValueUsd !== undefined
      ? { estimatedValueUsd: output.estimatedValueUsd }
      : {}),
    supportStatus: "SUPPORTED" as const,
    simulationStatus: "NOT_SIMULATED" as const,
  };

  switch (output.assetType) {
    case "ERC20":
      return {
        ...common,
        actionType: "TRANSFER_ERC20",
        parameters: {
          tokenAddress: output.tokenAddress,
          recipient: destinationAddress,
          amount: output.amount,
        },
      };
    case "ERC721":
      return {
        ...common,
        actionType: "TRANSFER_ERC721",
        parameters: {
          collectionAddress: output.collectionAddress,
          recipient: destinationAddress,
          tokenId: output.tokenId,
        },
      };
    case "ERC1155":
      return {
        ...common,
        actionType: "TRANSFER_ERC1155",
        parameters: {
          collectionAddress: output.collectionAddress,
          recipient: destinationAddress,
          tokenId: output.tokenId,
          amount: output.amount,
        },
      };
  }
}

function addTransferIndex(
  action: RescueAction,
  tokenTransfers: Map<string, string[]>,
  collectionTransfers: Map<string, string[]>,
): void {
  if (action.actionType === "TRANSFER_ERC20") {
    const key = action.parameters.tokenAddress.toLowerCase();
    tokenTransfers.set(key, [...(tokenTransfers.get(key) ?? []), action.id]);
  }
  if (
    action.actionType === "TRANSFER_ERC721" ||
    action.actionType === "TRANSFER_ERC1155"
  ) {
    const key = action.parameters.collectionAddress.toLowerCase();
    collectionTransfers.set(key, [
      ...(collectionTransfers.get(key) ?? []),
      action.id,
    ]);
  }
}

function outputContract(output: AdapterOutput): string {
  return output.assetType === "ERC20"
    ? output.tokenAddress.toLowerCase()
    : output.collectionAddress.toLowerCase();
}

function validateEvidenceScope(
  request: ParsedRescuePlanningRequest,
  trustedAdapters: readonly TrustedAdapterConfig[],
): void {
  if (request.scan.incidentId !== request.incidentId) {
    throw new Error("Wallet scan incident does not match the planning request");
  }

  for (const evidence of [...request.scan.assets, ...request.scan.approvals]) {
    if (evidence.chainId !== request.scan.chainId) {
      throw new Error(`Evidence ${evidence.id} has a mismatched chain ID`);
    }
    if (evidence.ownerAddress.toLowerCase() !== request.scan.address.toLowerCase()) {
      throw new Error(`Evidence ${evidence.id} has a mismatched owner address`);
    }
  }

  const candidateIds = new Set<string>();
  for (const candidate of request.adapterCandidates) {
    if (candidateIds.has(candidate.id)) {
      throw new Error(`Duplicate adapter candidate ID: ${candidate.id}`);
    }
    candidateIds.add(candidate.id);

    if (candidate.chainId !== request.scan.chainId) {
      throw new Error(`Adapter candidate ${candidate.id} has a mismatched chain ID`);
    }
    if (candidate.sourceAddress.toLowerCase() !== request.scan.address.toLowerCase()) {
      throw new Error(`Adapter candidate ${candidate.id} has a mismatched source address`);
    }

    const trusted = trustedAdapters.find(
      (config) =>
        config.adapterId === candidate.adapterId &&
        config.adapterVersion === candidate.adapterVersion &&
        config.chainId === candidate.chainId &&
        config.contractAddress.toLowerCase() === candidate.contractAddress.toLowerCase(),
    );
    if (!trusted || !trusted.supportedActions.includes(candidate.actionType)) {
      throw new Error(`Adapter candidate ${candidate.id} is not trusted by this planner`);
    }

    if (
      candidate.actionType === "CUSTOM_SUPPORTED_ADAPTER" &&
      !trusted.allowedCustomOperationIds.includes(candidate.operationId)
    ) {
      throw new Error(
        `Adapter candidate ${candidate.id} uses an untrusted custom operation`,
      );
    }

    const allowedOutputs = new Set(
      trusted.allowedOutputContracts.map((address) => address.toLowerCase()),
    );
    for (const output of candidate.outputs) {
      if (!allowedOutputs.has(outputContract(output))) {
        throw new Error(
          `Adapter candidate ${candidate.id} contains an untrusted output contract`,
        );
      }
    }
  }
}

export interface RescuePlanner {
  plan(request: RescuePlanningRequest): RescuePlan;
}

export type DeterministicRescuePlannerOptions = {
  clock?: () => Date;
  trustedAdapters?: readonly TrustedAdapterConfigInput[];
};

export class DeterministicRescuePlanner implements RescuePlanner {
  private readonly clock: () => Date;
  private readonly trustedAdapters: readonly TrustedAdapterConfig[];

  constructor(options: DeterministicRescuePlannerOptions = {}) {
    this.clock = options.clock ?? (() => new Date());
    this.trustedAdapters = (options.trustedAdapters ?? []).map((config) =>
      trustedAdapterConfigSchema.parse(config),
    );
  }

  plan(value: RescuePlanningRequest): RescuePlan {
    const request = rescuePlanningRequestSchema.parse(value);
    validateIncidentAddresses(request.scan.address, request.destinationAddress);
    validateEvidenceScope(request, this.trustedAdapters);

    const actions: RescueAction[] = [];
    const priorities = new Map<string, ActionPriority>();
    const omissions: PlanOmission[] = [];
    const nativeAssets: Extract<Asset, { assetType: "NATIVE" }>[] = [];
    const tokenTransfers = new Map<string, string[]>();
    const collectionTransfers = new Map<string, string[]>();

    const addAction = (action: RescueAction): void => {
      actions.push(action);
      priorities.set(action.id, priorityFor(action));
      addTransferIndex(action, tokenTransfers, collectionTransfers);
    };

    if (request.scan.status !== "COMPLETE") {
      omissions.push({
        evidenceId: request.scan.id,
        supportStatus: "UNKNOWN",
        reason: "The wallet scan is incomplete; missing state was not treated as empty.",
      });
    }

    for (const asset of request.scan.assets) {
      if (asset.supportStatus !== "SUPPORTED") {
        omissions.push(
          omissionForUnsupportedEvidence(
            asset,
            "The asset was detected but does not have verified planner support.",
          ),
        );
        continue;
      }

      if (asset.assetType === "NATIVE") {
        if (BigInt(asset.balance) > 0n) {
          nativeAssets.push(asset);
        }
        continue;
      }

      if (asset.assetType !== "ERC721" && BigInt(asset.balance) === 0n) {
        continue;
      }
      addAction(transferActionForAsset(asset, request.destinationAddress));
    }

    for (const candidate of request.adapterCandidates) {
      const parentAction = adapterAction(candidate);
      addAction(parentAction);
      for (const output of candidate.outputs) {
        addAction(
          transferActionForAdapterOutput(
            candidate,
            output,
            request.destinationAddress,
            parentAction.id,
          ),
        );
      }
    }

    for (const approval of request.scan.approvals) {
      if (approval.supportStatus !== "SUPPORTED") {
        omissions.push(
          omissionForUnsupportedEvidence(
            approval,
            "The approval does not have verified planner support.",
          ),
        );
        continue;
      }

      if (approval.approvalType === "ERC20_ALLOWANCE") {
        if (BigInt(approval.amount) === 0n) {
          continue;
        }
        const action: RescueAction = {
          id: `action:revoke:${approval.id}`,
          chainId: approval.chainId,
          sourceAddress: approval.ownerAddress,
          dependencies: [
            ...(tokenTransfers.get(approval.tokenAddress.toLowerCase()) ?? []),
          ],
          evidenceIds: [approval.id],
          expectedEffects: [
            {
              effectType: "ALLOWANCE_REVOKED",
              description: "Set the detected ERC-20 allowance to zero.",
            },
          ],
          riskLevel: "HIGH",
          supportStatus: "SUPPORTED",
          simulationStatus: "NOT_SIMULATED",
          actionType: "REVOKE_ERC20_APPROVAL",
          parameters: {
            tokenAddress: approval.tokenAddress,
            spenderAddress: approval.spenderAddress,
          },
        };
        addAction(action);
        continue;
      }

      if (approval.approvalType === "NFT_OPERATOR") {
        if (!approval.approved) {
          continue;
        }
        const action: RescueAction = {
          id: `action:revoke:${approval.id}`,
          chainId: approval.chainId,
          sourceAddress: approval.ownerAddress,
          dependencies: [
            ...(collectionTransfers.get(approval.collectionAddress.toLowerCase()) ?? []),
          ],
          evidenceIds: [approval.id],
          expectedEffects: [
            {
              effectType: "ALLOWANCE_REVOKED",
              description: "Remove the detected NFT operator approval.",
            },
          ],
          riskLevel: "HIGH",
          supportStatus: "SUPPORTED",
          simulationStatus: "NOT_SIMULATED",
          actionType: "REVOKE_NFT_OPERATOR",
          parameters: {
            standard: approval.standard,
            collectionAddress: approval.collectionAddress,
            operatorAddress: approval.operatorAddress,
          },
        };
        addAction(action);
        continue;
      }

      omissions.push({
        evidenceId: approval.id,
        supportStatus: "UNSUPPORTED",
        reason: "Per-token ERC-721 approval revocation is not an allowlisted action type.",
      });
    }

    if (nativeAssets.length > 1) {
      for (const duplicate of nativeAssets.slice(1)) {
        omissions.push({
          evidenceId: duplicate.id,
          supportStatus: "UNSUPPORTED",
          reason: "Duplicate native-balance evidence was excluded from the plan.",
        });
      }
    }

    const nativeAsset = nativeAssets[0];
    if (nativeAsset) {
      const estimatedValueUsd = nativeAsset.valuation?.estimatedValueUsd;
      const nativeAction: RescueAction = {
        id: `action:transfer:${nativeAsset.id}`,
        chainId: nativeAsset.chainId,
        sourceAddress: nativeAsset.ownerAddress,
        dependencies: actions.map((action) => action.id),
        evidenceIds: [nativeAsset.id],
        expectedEffects: [
          {
            effectType: "ASSET_TRANSFERRED",
            assetId: nativeAsset.id,
            description:
              "Move up to the scanned native balance after simulation reserves execution gas.",
          },
        ],
        riskLevel: riskForValue(estimatedValueUsd),
        ...(estimatedValueUsd !== undefined ? { estimatedValueUsd } : {}),
        supportStatus: "SUPPORTED",
        simulationStatus: "NOT_SIMULATED",
        actionType: "TRANSFER_NATIVE",
        parameters: {
          recipient: request.destinationAddress,
          maximumAmount: nativeAsset.balance,
          amountStrategy: "MAX_MINUS_GAS_RESERVE",
        },
      };
      addAction(nativeAction);
    }

    const orderedActions = topologicalPrioritySort(actions, priorities);
    const payload: Omit<RescuePlan, "integrityHash"> = {
      id: `plan:${request.incidentId}:1:${request.scan.observedAtBlock}`,
      incidentId: request.incidentId,
      version: 1,
      policyVersion: request.policyVersion,
      chainId: request.scan.chainId,
      sourceAddress: request.scan.address,
      destinationAddress: request.destinationAddress,
      observedAtBlock: request.scan.observedAtBlock,
      status: omissions.length > 0 ? "PARTIAL" : "READY",
      actions: orderedActions,
      omissions,
      createdAt: this.clock().toISOString(),
    };
    const plan = rescuePlanSchema.parse({
      ...payload,
      integrityHash: computePlanIntegrityHash(payload),
    });

    return deepFreezePlan(plan);
  }
}
