import { describe, expect, it } from "vitest";

import {
  agentJobSchema,
  approvalSchema,
  assetSchema,
  incidentSchema,
  rescueAssetManifestSchema,
  rescueActionSchema,
  rescuePlanSchema,
  simulationResultSchema,
  walletScanSchema,
} from "../src/schemas";

const sourceAddress = "0x1111111111111111111111111111111111111111";
const destinationAddress = "0x2222222222222222222222222222222222222222";
const tokenAddress = "0x3333333333333333333333333333333333333333";
const spenderAddress = "0x4444444444444444444444444444444444444444";
const now = "2026-07-11T12:00:00.000Z";

const erc20Asset = {
  id: "asset-usdc",
  chainId: 196,
  ownerAddress: sourceAddress,
  supportStatus: "SUPPORTED",
  observedAtBlock: "12345",
  discoverySource: "demo-indexer",
  confidence: 1,
  assetType: "ERC20",
  contractAddress: tokenAddress,
  name: "Demo USD",
  symbol: "DUSD",
  decimals: 6,
  balance: "1000000",
} as const;

const erc20Approval = {
  id: "approval-usdc",
  chainId: 196,
  ownerAddress: sourceAddress,
  supportStatus: "SUPPORTED",
  observedAtBlock: "12345",
  discoverySource: "demo-indexer",
  approvalType: "ERC20_ALLOWANCE",
  tokenAddress,
  spenderAddress,
  amount: "1000000",
} as const;

const transferAction = {
  id: "action-transfer-usdc",
  chainId: 196,
  sourceAddress,
  dependencies: [],
  evidenceIds: ["asset-usdc"],
  expectedEffects: [
    {
      effectType: "ASSET_TRANSFERRED",
      assetId: "asset-usdc",
      description: "Move the detected token balance to the confirmed destination.",
    },
  ],
  riskLevel: "MEDIUM",
  supportStatus: "SUPPORTED",
  simulationStatus: "NOT_SIMULATED",
  actionType: "TRANSFER_ERC20",
  parameters: {
    tokenAddress,
    recipient: destinationAddress,
    amount: "1000000",
  },
} as const;

describe("incidentSchema", () => {
  it("parses a non-custodial incident record", () => {
    const result = incidentSchema.parse({
      id: "incident-1",
      chainId: 196,
      sourceAddress,
      destinationAddress,
      status: "RECEIVED",
      ownershipAttestation: {
        accepted: true,
        statementVersion: "v1",
        attestedAt: now,
      },
      createdAt: now,
      updatedAt: now,
    });

    expect(result.sourceAddress).toBe(sourceAddress);
    expect(result.ownershipAttestation.accepted).toBe(true);
  });

  it("commits a bounded multi-standard asset batch", () => {
    const manifest = rescueAssetManifestSchema.parse({
      erc20TokenAddresses: [tokenAddress],
      erc721Assets: [{ collectionAddress: spenderAddress, tokenId: "7" }],
    });
    expect(manifest).toEqual({
      erc20TokenAddresses: [tokenAddress],
      erc721Assets: [{ collectionAddress: spenderAddress, tokenId: "7" }],
      erc1155Assets: [],
    });
    expect(() => rescueAssetManifestSchema.parse({})).toThrow();
    expect(() => rescueAssetManifestSchema.parse({
      erc20TokenAddresses: [tokenAddress, tokenAddress],
    })).toThrow("Duplicate asset entry");
  });

  it("rejects a destination equal to the source", () => {
    const result = incidentSchema.safeParse({
      id: "incident-1",
      chainId: 196,
      sourceAddress,
      destinationAddress: sourceAddress.toUpperCase().replace("0X", "0x"),
      status: "RECEIVED",
      ownershipAttestation: {
        accepted: true,
        statementVersion: "v1",
        attestedAt: now,
      },
      createdAt: now,
      updatedAt: now,
    });

    expect(result.success).toBe(false);
  });

  it("requires an affirmative ownership attestation", () => {
    const result = incidentSchema.safeParse({
      id: "incident-1",
      chainId: 196,
      sourceAddress,
      destinationAddress,
      status: "RECEIVED",
      ownershipAttestation: {
        accepted: false,
        statementVersion: "v1",
        attestedAt: now,
      },
      createdAt: now,
      updatedAt: now,
    });

    expect(result.success).toBe(false);
  });
});

describe("wallet evidence schemas", () => {
  it("parses assets and approvals inside a block-pinned scan", () => {
    expect(assetSchema.parse(erc20Asset).assetType).toBe("ERC20");
    expect(approvalSchema.parse(erc20Approval).approvalType).toBe("ERC20_ALLOWANCE");

    const scan = walletScanSchema.parse({
      id: "scan-1",
      incidentId: "incident-1",
      chainId: 196,
      address: sourceAddress,
      status: "COMPLETE",
      providerId: "demo-provider",
      observedAtBlock: "12345",
      observedAt: now,
      assets: [erc20Asset],
      approvals: [erc20Approval],
      warnings: [],
    });

    expect(scan.assets).toHaveLength(1);
    expect(scan.approvals).toHaveLength(1);
  });

  it("rejects negative base-unit amounts", () => {
    expect(assetSchema.safeParse({ ...erc20Asset, balance: "-1" }).success).toBe(false);
    expect(approvalSchema.safeParse({ ...erc20Approval, amount: "-1" }).success).toBe(
      false,
    );
  });
});

describe("rescue action and plan schemas", () => {
  it("parses an allowlisted typed rescue action", () => {
    expect(rescueActionSchema.parse(transferAction).actionType).toBe("TRANSFER_ERC20");
  });

  it("rejects arbitrary calldata at the action boundary", () => {
    const result = rescueActionSchema.safeParse({
      ...transferAction,
      data: "0xdeadbeef",
    });

    expect(result.success).toBe(false);
  });

  it("rejects arbitrary calldata inside typed parameters", () => {
    const result = rescueActionSchema.safeParse({
      ...transferAction,
      parameters: {
        ...transferAction.parameters,
        data: "0xdeadbeef",
      },
    });

    expect(result.success).toBe(false);
  });

  it("parses a plan whose dependencies reference known actions", () => {
    const revokeAction = {
      ...transferAction,
      id: "action-revoke-usdc",
      dependencies: [transferAction.id],
      evidenceIds: ["approval-usdc"],
      expectedEffects: [
        {
          effectType: "ALLOWANCE_REVOKED",
          description: "Remove the residual token allowance.",
        },
      ],
      actionType: "REVOKE_ERC20_APPROVAL",
      parameters: {
        tokenAddress,
        spenderAddress,
      },
    } as const;

    const plan = rescuePlanSchema.parse({
      id: "plan-1",
      incidentId: "incident-1",
      version: 1,
      policyVersion: "phase-1",
      chainId: 196,
      sourceAddress,
      destinationAddress,
      observedAtBlock: "12345",
      status: "READY",
      actions: [transferAction, revokeAction],
      omissions: [],
      integrityHash: `0x${"b".repeat(64)}`,
      createdAt: now,
    });

    expect(plan.actions).toHaveLength(2);
  });

  it("rejects missing and self-referencing dependencies", () => {
    const missingDependency = {
      ...transferAction,
      dependencies: ["not-in-plan"],
    };
    const selfDependency = {
      ...transferAction,
      dependencies: [transferAction.id],
    };

    for (const action of [missingDependency, selfDependency]) {
      const result = rescuePlanSchema.safeParse({
        id: "plan-1",
        incidentId: "incident-1",
        version: 1,
        policyVersion: "phase-1",
        chainId: 196,
        sourceAddress,
        destinationAddress,
        observedAtBlock: "12345",
        status: "READY",
        actions: [action],
        omissions: [],
        integrityHash: `0x${"b".repeat(64)}`,
        createdAt: now,
      });

      expect(result.success).toBe(false);
    }
  });
});

describe("simulationResultSchema", () => {
  it("parses a successful action-level simulation", () => {
    const result = simulationResultSchema.parse({
      id: "simulation-1",
      planId: "plan-1",
      actionId: transferAction.id,
      providerId: "local-call",
      status: "SUCCEEDED",
      planHash: `0x${"a".repeat(64)}`,
      observedAtBlock: "12345",
      gasEstimate: "65000",
      expectedEffects: transferAction.expectedEffects,
      assetChanges: [],
      warnings: [],
      simulatedAt: now,
      expiresAt: "2026-07-11T12:05:00.000Z",
    });

    expect(result.status).toBe("SUCCEEDED");
  });

  it("requires a reason for non-successful simulations", () => {
    const result = simulationResultSchema.safeParse({
      id: "simulation-1",
      planId: "plan-1",
      actionId: transferAction.id,
      providerId: "local-call",
      status: "REVERTED",
      planHash: `0x${"a".repeat(64)}`,
      observedAtBlock: "12345",
      expectedEffects: [],
      assetChanges: [],
      warnings: [],
      simulatedAt: now,
      expiresAt: "2026-07-11T12:05:00.000Z",
    });

    expect(result.success).toBe(false);
  });
});

describe("agentJobSchema", () => {
  it("parses the internal agent job without implying an OKX integration", () => {
    const job = agentJobSchema.parse({
      id: "job-1",
      service: "safeexit-incident-response",
      status: "WAITING_FOR_USER",
      incidentId: "incident-1",
      dashboardUrl: "https://safeexit.example/incidents/incident-1",
      createdAt: now,
      updatedAt: now,
    });

    expect(job.status).toBe("WAITING_FOR_USER");
  });
});
