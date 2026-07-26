import { describe, expect, it } from "vitest";

import {
  evmAddressSchema,
  walletScanSchema,
  type Asset,
  type RescuePlan,
} from "@safeexit/shared";

import {
  DeterministicRescuePlanner,
  verifyPlanIntegrity,
  type RescuePlanningRequest,
} from "../src";

const sourceAddress = evmAddressSchema.parse(
  "0x1111111111111111111111111111111111111111",
);
const destinationAddress = evmAddressSchema.parse(
  "0x2222222222222222222222222222222222222222",
);
const alternateDestination = evmAddressSchema.parse(
  "0x9999999999999999999999999999999999999999",
);
const tokenAddress = evmAddressSchema.parse(
  "0x3333333333333333333333333333333333333333",
);
const secondTokenAddress = evmAddressSchema.parse(
  "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
);
const erc721Address = evmAddressSchema.parse(
  "0x4444444444444444444444444444444444444444",
);
const erc1155Address = evmAddressSchema.parse(
  "0x5555555555555555555555555555555555555555",
);
const spenderAddress = evmAddressSchema.parse(
  "0x6666666666666666666666666666666666666666",
);
const operatorAddress = evmAddressSchema.parse(
  "0x7777777777777777777777777777777777777777",
);
const adapterContract = evmAddressSchema.parse(
  "0x8888888888888888888888888888888888888888",
);
const now = "2026-07-11T12:00:00.000Z";

const evidenceBase = {
  chainId: 31_337,
  ownerAddress: sourceAddress,
  supportStatus: "SUPPORTED" as const,
  observedAtBlock: "100",
  discoverySource: "mock-anvil",
  confidence: 1,
};

function makeScan(options: {
  assets?: readonly unknown[];
  approvals?: readonly unknown[];
  status?: "COMPLETE" | "PARTIAL" | "FAILED";
} = {}) {
  return walletScanSchema.parse({
    id: "scan-1",
    incidentId: "incident-1",
    chainId: 31_337,
    address: sourceAddress,
    status: options.status ?? "COMPLETE",
    providerId: "mock-anvil",
    observedAtBlock: "100",
    observedAt: now,
    assets: options.assets ?? [],
    approvals: options.approvals ?? [],
    warnings: [],
  });
}

function makePlanner() {
  return new DeterministicRescuePlanner({
    clock: () => new Date("2026-07-11T12:01:00.000Z"),
    trustedAdapters: [
      {
        adapterId: "demo-airdrop",
        adapterVersion: "1.0.0",
        chainId: 31_337,
        contractAddress: adapterContract,
        supportedActions: ["CLAIM_SUPPORTED_AIRDROP"],
        allowedOutputContracts: [tokenAddress],
      },
      {
        adapterId: "demo-position",
        adapterVersion: "1.0.0",
        chainId: 31_337,
        contractAddress: adapterContract,
        supportedActions: ["WITHDRAW_SUPPORTED_POSITION"],
      },
      {
        adapterId: "demo-custom",
        adapterVersion: "1.0.0",
        chainId: 31_337,
        contractAddress: adapterContract,
        supportedActions: ["CUSTOM_SUPPORTED_ADAPTER"],
        allowedCustomOperationIds: ["reviewed-operation-1"],
      },
    ],
  });
}

function planScan(
  scan: ReturnType<typeof makeScan>,
  overrides: Partial<RescuePlanningRequest> = {},
) {
  return makePlanner().plan({
    incidentId: "incident-1",
    destinationAddress,
    policyVersion: "phase-3-v1",
    scan,
    ...overrides,
  });
}

const nativeAsset = {
  ...evidenceBase,
  id: "asset-native",
  assetType: "NATIVE",
  symbol: "ETH",
  decimals: 18,
  balance: "1000000000000000000",
} as const;

const erc20Asset = {
  ...evidenceBase,
  id: "asset-erc20",
  assetType: "ERC20",
  contractAddress: tokenAddress,
  name: "Demo USD",
  symbol: "DUSD",
  decimals: 6,
  balance: "1000000",
} as const;

const erc721Asset = {
  ...evidenceBase,
  id: "asset-erc721",
  assetType: "ERC721",
  contractAddress: erc721Address,
  tokenId: "7",
  name: "Demo Pass",
} as const;

const erc1155Asset = {
  ...evidenceBase,
  id: "asset-erc1155",
  assetType: "ERC1155",
  contractAddress: erc1155Address,
  tokenId: "9",
  balance: "3",
} as const;

const erc20Approval = {
  id: "approval-erc20",
  chainId: 31_337,
  ownerAddress: sourceAddress,
  supportStatus: "SUPPORTED",
  observedAtBlock: "100",
  discoverySource: "mock-anvil",
  approvalType: "ERC20_ALLOWANCE",
  tokenAddress,
  spenderAddress,
  amount: "1000000",
} as const;

const nftOperatorApproval = {
  id: "approval-nft-operator",
  chainId: 31_337,
  ownerAddress: sourceAddress,
  supportStatus: "SUPPORTED",
  observedAtBlock: "100",
  discoverySource: "mock-anvil",
  approvalType: "NFT_OPERATOR",
  standard: "ERC721",
  collectionAddress: erc721Address,
  operatorAddress,
  approved: true,
} as const;

describe("DeterministicRescuePlanner", () => {
  it("generates standard asset transfers and approval revocations", () => {
    const plan = planScan(
      makeScan({
        assets: [nativeAsset, erc20Asset, erc721Asset, erc1155Asset],
        approvals: [erc20Approval, nftOperatorApproval],
      }),
    );
    const actionTypes = new Set(plan.actions.map((action) => action.actionType));

    expect(actionTypes).toEqual(
      new Set([
        "TRANSFER_NATIVE",
        "TRANSFER_ERC20",
        "TRANSFER_ERC721",
        "TRANSFER_ERC1155",
        "REVOKE_ERC20_APPROVAL",
        "REVOKE_NFT_OPERATOR",
      ]),
    );
    expect(plan.status).toBe("READY");
    expect(plan.actions.at(-1)?.actionType).toBe("TRANSFER_NATIVE");
    expect(verifyPlanIntegrity(plan)).toBe(true);
  });

  it("rejects identical source and destination addresses", () => {
    expect(() =>
      planScan(makeScan(), {
        destinationAddress: sourceAddress,
      }),
    ).toThrow("Source and destination addresses must be different");
  });

  it("creates claim, withdrawal, custom adapter, and dependent output actions", () => {
    const plan = planScan(makeScan(), {
      adapterCandidates: [
        {
          id: "claim-1",
          evidenceId: "claim-evidence-1",
          verification: "VERIFIED_ADAPTER",
          adapterId: "demo-airdrop",
          adapterVersion: "1.0.0",
          chainId: 31_337,
          sourceAddress,
          contractAddress: adapterContract,
          description: "Claim the verified demo reward.",
          riskLevel: "HIGH",
          estimatedValueUsd: 2_000,
          expectedEffects: [],
          outputs: [
            {
              id: "claim-output-token",
              assetType: "ERC20",
              tokenAddress,
              amount: "500000",
              estimatedValueUsd: 500,
            },
          ],
          actionType: "CLAIM_SUPPORTED_AIRDROP",
          claimReference: "round-1",
        },
        {
          id: "withdraw-1",
          evidenceId: "position-evidence-1",
          verification: "VERIFIED_ADAPTER",
          adapterId: "demo-position",
          adapterVersion: "1.0.0",
          chainId: 31_337,
          sourceAddress,
          contractAddress: adapterContract,
          description: "Withdraw the verified demo position.",
          riskLevel: "MEDIUM",
          expectedEffects: [],
          outputs: [],
          actionType: "WITHDRAW_SUPPORTED_POSITION",
          positionId: "position-7",
        },
        {
          id: "custom-1",
          evidenceId: "custom-evidence-1",
          verification: "VERIFIED_ADAPTER",
          adapterId: "demo-custom",
          adapterVersion: "1.0.0",
          chainId: 31_337,
          sourceAddress,
          contractAddress: adapterContract,
          description: "Run a reviewed adapter operation.",
          riskLevel: "LOW",
          expectedEffects: [],
          outputs: [],
          actionType: "CUSTOM_SUPPORTED_ADAPTER",
          operationId: "reviewed-operation-1",
        },
      ],
    });

    expect(plan.actions.map((action) => action.actionType)).toEqual([
      "CLAIM_SUPPORTED_AIRDROP",
      "TRANSFER_ERC20",
      "WITHDRAW_SUPPORTED_POSITION",
      "CUSTOM_SUPPORTED_ADAPTER",
    ]);

    const claim = plan.actions.find(
      (action) => action.actionType === "CLAIM_SUPPORTED_AIRDROP",
    );
    const claimedTokenTransfer = plan.actions.find(
      (action) =>
        action.actionType === "TRANSFER_ERC20" &&
        action.evidenceIds.includes("claim-output-token"),
    );
    expect(claimedTokenTransfer?.dependencies).toEqual([claim?.id]);
    expect(plan.actions.indexOf(claim!)).toBeLessThan(
      plan.actions.indexOf(claimedTokenTransfer!),
    );
  });

  it("orders revocation after the related asset transfer", () => {
    const plan = planScan(
      makeScan({
        assets: [erc20Asset, erc721Asset],
        approvals: [erc20Approval, nftOperatorApproval],
      }),
    );
    const erc20Transfer = plan.actions.find(
      (action) => action.actionType === "TRANSFER_ERC20",
    );
    const erc20Revoke = plan.actions.find(
      (action) => action.actionType === "REVOKE_ERC20_APPROVAL",
    );
    const nftTransfer = plan.actions.find(
      (action) => action.actionType === "TRANSFER_ERC721",
    );
    const nftRevoke = plan.actions.find(
      (action) => action.actionType === "REVOKE_NFT_OPERATOR",
    );

    expect(erc20Revoke?.dependencies).toContain(erc20Transfer?.id);
    expect(nftRevoke?.dependencies).toContain(nftTransfer?.id);
    expect(plan.actions.indexOf(erc20Transfer!)).toBeLessThan(
      plan.actions.indexOf(erc20Revoke!),
    );
    expect(plan.actions.indexOf(nftTransfer!)).toBeLessThan(
      plan.actions.indexOf(nftRevoke!),
    );
  });

  it("prioritizes higher-value independently transferable assets", () => {
    const lowValueAsset: Asset = {
      ...erc20Asset,
      id: "asset-low-value",
      valuation: {
        estimatedValueUsd: 50,
        source: "explicit-test-fixture",
        observedAt: now,
      },
    };
    const highValueAsset: Asset = {
      ...erc20Asset,
      id: "asset-high-value",
      contractAddress: secondTokenAddress,
      valuation: {
        estimatedValueUsd: 20_000,
        source: "explicit-test-fixture",
        observedAt: now,
      },
    };
    const plan = planScan(makeScan({ assets: [lowValueAsset, highValueAsset] }));

    expect(plan.actions[0]?.evidenceIds).toContain("asset-high-value");
    expect(plan.actions[0]?.riskLevel).toBe("CRITICAL");
    expect(plan.actions[1]?.evidenceIds).toContain("asset-low-value");
  });

  it("keeps equal-priority asset order stable when scan evidence IDs change", () => {
    const firstScan = planScan(
      makeScan({
        assets: [
          { ...erc20Asset, id: "evidence:z", contractAddress: tokenAddress },
          {
            ...erc20Asset,
            id: "evidence:a",
            contractAddress: secondTokenAddress,
          },
        ],
      }),
    );
    const laterScan = planScan(
      makeScan({
        assets: [
          {
            ...erc20Asset,
            id: "evidence:y",
            contractAddress: secondTokenAddress,
            observedAtBlock: "101",
          },
          {
            ...erc20Asset,
            id: "evidence:b",
            contractAddress: tokenAddress,
            observedAtBlock: "101",
          },
        ],
      }),
    );
    const orderedContracts = (plan: RescuePlan) =>
      plan.actions.flatMap((action) =>
        action.actionType === "TRANSFER_ERC20"
          ? [action.parameters.tokenAddress.toLowerCase()]
          : [],
      );

    expect(orderedContracts(firstScan)).toEqual([
      tokenAddress.toLowerCase(),
      secondTokenAddress.toLowerCase(),
    ]);
    expect(orderedContracts(laterScan)).toEqual(orderedContracts(firstScan));
  });

  it("omits unsupported assets and marks the plan partial", () => {
    const unsupportedAsset = {
      ...erc20Asset,
      id: "asset-unsupported",
      supportStatus: "UNSUPPORTED",
    } as const;
    const plan = planScan(makeScan({ assets: [unsupportedAsset] }));

    expect(plan.status).toBe("PARTIAL");
    expect(plan.actions).toEqual([]);
    expect(plan.omissions).toEqual([
      expect.objectContaining({
        evidenceId: "asset-unsupported",
        supportStatus: "UNSUPPORTED",
      }),
    ]);
  });

  it("rejects untyped executable-list injection and detects later plan changes", () => {
    const planner = makePlanner();
    const unsafeInput = {
      incidentId: "incident-1",
      destinationAddress,
      policyVersion: "phase-3-v1",
      scan: makeScan({ assets: [erc20Asset] }),
      aiGeneratedActions: [
        {
          target: adapterContract,
          data: "0xdeadbeef",
        },
      ],
    } as unknown as RescuePlanningRequest;

    expect(() => planner.plan(unsafeInput)).toThrow();

    const plan = planScan(makeScan({ assets: [erc20Asset] }));
    expect(Object.isFrozen(plan)).toBe(true);
    expect(Object.isFrozen(plan.actions)).toBe(true);

    const tampered = structuredClone(plan) as RescuePlan;
    const transfer = tampered.actions[0];
    if (!transfer || transfer.actionType !== "TRANSFER_ERC20") {
      throw new Error("Expected an ERC-20 transfer fixture");
    }
    transfer.parameters.recipient = alternateDestination;

    expect(verifyPlanIntegrity(tampered)).toBe(false);
  });

  it("rejects adapter candidates when no code-owned trust configuration exists", () => {
    const planner = new DeterministicRescuePlanner({
      clock: () => new Date("2026-07-11T12:01:00.000Z"),
    });

    expect(() =>
      planner.plan({
        incidentId: "incident-1",
        destinationAddress,
        policyVersion: "phase-3-v1",
        scan: makeScan(),
        adapterCandidates: [
          {
            id: "untrusted-claim",
            evidenceId: "untrusted-evidence",
            verification: "VERIFIED_ADAPTER",
            adapterId: "untrusted-adapter",
            adapterVersion: "1.0.0",
            chainId: 31_337,
            sourceAddress,
            contractAddress: adapterContract,
            description: "This label alone must not grant trust.",
            riskLevel: "HIGH",
            expectedEffects: [],
            outputs: [],
            actionType: "CLAIM_SUPPORTED_AIRDROP",
            claimReference: "untrusted",
          },
        ],
      }),
    ).toThrow("is not trusted by this planner");
  });
});
