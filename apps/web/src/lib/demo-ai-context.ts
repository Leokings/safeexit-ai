import { aiIncidentContextSchema } from "@safeexit/ai";

import { demoIncident } from "./demo-incident";
import type { DemoRuntimeState } from "./demo-runtime";

const defaultObservedAt = "2026-07-11T12:00:00.000Z";
const planHash = `0x${"7".repeat(64)}`;

const actions = [
  {
    id: "action:claim",
    chainId: demoIncident.chainId,
    sourceAddress: demoIncident.source,
    dependencies: [],
    evidenceIds: ["claim:srt"],
    expectedEffects: [
      { effectType: "BALANCE_INCREASE" as const, description: "Claim 50 SRT to the source." },
    ],
    riskLevel: "HIGH" as const,
    supportStatus: "SUPPORTED" as const,
    simulationStatus: "PASSED" as const,
    actionType: "CLAIM_SUPPORTED_AIRDROP" as const,
    parameters: {
      adapterId: "demo-airdrop-v1",
      contractAddress: demoIncident.contracts.airdrop,
      claimReference: "demo-claim-50-srt",
    },
  },
  {
    id: "action:token",
    chainId: demoIncident.chainId,
    sourceAddress: demoIncident.source,
    dependencies: ["action:claim"],
    evidenceIds: ["asset:srt", "claim:srt"],
    expectedEffects: [
      {
        effectType: "ASSET_TRANSFERRED" as const,
        assetId: "asset:srt",
        description: "Move 150 SRT to the confirmed destination.",
      },
    ],
    riskLevel: "HIGH" as const,
    supportStatus: "SUPPORTED" as const,
    simulationStatus: "PASSED" as const,
    actionType: "TRANSFER_ERC20" as const,
    parameters: {
      tokenAddress: demoIncident.contracts.token,
      recipient: demoIncident.destination,
      amount: "150000000000000000000",
    },
  },
  {
    id: "action:nft",
    chainId: demoIncident.chainId,
    sourceAddress: demoIncident.source,
    dependencies: [],
    evidenceIds: ["asset:nft:1"],
    expectedEffects: [
      {
        effectType: "ASSET_TRANSFERRED" as const,
        assetId: "asset:nft:1",
        description: "Move Demo NFT #1 to the confirmed destination.",
      },
    ],
    riskLevel: "HIGH" as const,
    supportStatus: "SUPPORTED" as const,
    simulationStatus: "PASSED" as const,
    actionType: "TRANSFER_ERC721" as const,
    parameters: {
      collectionAddress: demoIncident.contracts.nft,
      recipient: demoIncident.destination,
      tokenId: "1",
    },
  },
  {
    id: "action:revoke",
    chainId: demoIncident.chainId,
    sourceAddress: demoIncident.source,
    dependencies: ["action:token", "action:nft"],
    evidenceIds: ["approval:demo-attacker"],
    expectedEffects: [
      { effectType: "ALLOWANCE_REVOKED" as const, description: "Set allowance to zero." },
    ],
    riskLevel: "HIGH" as const,
    supportStatus: "SUPPORTED" as const,
    simulationStatus: "PASSED" as const,
    actionType: "REVOKE_ERC20_APPROVAL" as const,
    parameters: {
      tokenAddress: demoIncident.contracts.token,
      spenderAddress: demoIncident.contracts.attackerSimulation,
    },
  },
] as const;

export function createDemoAiContext(runtime?: DemoRuntimeState) {
  const observedAt = runtime?.report?.updatedAt ?? defaultObservedAt;
  const expiresAt = new Date(new Date(observedAt).getTime() + 5 * 60_000).toISOString();
  const blockNumber = runtime?.chain?.blockNumber ?? "18";
  const sourceTokenBalance = runtime?.chain?.sourceTokenBalance ?? "100000000000000000000";
  const allowance = runtime?.chain?.activeAllowance ?? "25000000000000000000";
  const sourceOwnsNft =
    !runtime?.chain || runtime.chain.nftOwner.toLowerCase() === demoIncident.source.toLowerCase();
  const completedActionIds =
    runtime?.report?.actions
      .filter((action) => action.status === "COMPLETED")
      .map((action) => action.id) ?? [];
  const failedActionIds =
    runtime?.report?.actions
      .filter((action) => action.status === "FAILED")
      .map((action) => action.id) ?? [];
  const transactionHashes =
    runtime?.report?.actions.flatMap((action) =>
      action.transactionHash ? [action.transactionHash] : [],
    ) ?? [];
  const incidentStatus =
    runtime?.actualState === "RESCUED"
      ? "COMPLETED"
      : runtime?.report?.phase === "EXECUTING"
        ? "EXECUTING"
        : runtime?.report?.phase === "FAILED"
          ? "FAILED"
          : "WAITING_FOR_USER";

  return aiIncidentContextSchema.parse({
  incident: {
    id: demoIncident.id,
    chainId: demoIncident.chainId,
    sourceAddress: demoIncident.source,
    destinationAddress: demoIncident.destination,
    status: incidentStatus,
    ownershipAttestation: {
      accepted: true,
      statementVersion: "demo-1",
      attestedAt: observedAt,
    },
    createdAt: observedAt,
    updatedAt: observedAt,
  },
  scan: {
    id: "scan:demo-31337",
    incidentId: demoIncident.id,
    chainId: demoIncident.chainId,
    address: demoIncident.source,
    status: "COMPLETE",
    providerId: "phase-5-anvil-fixture",
    observedAtBlock: blockNumber,
    observedAt,
    assets: [
      {
        id: "asset:srt",
        chainId: demoIncident.chainId,
        ownerAddress: demoIncident.source,
        supportStatus: sourceTokenBalance === "0" ? "SUPPORTED" : "DETECTED",
        observedAtBlock: blockNumber,
        discoverySource: "demo-manifest:erc20",
        confidence: 1,
        assetType: "ERC20",
        contractAddress: demoIncident.contracts.token,
        name: "RescueToken",
        symbol: "SRT",
        decimals: 18,
        balance: sourceTokenBalance,
      },
      ...(sourceOwnsNft ? [{
        id: "asset:nft:1",
        chainId: demoIncident.chainId,
        ownerAddress: demoIncident.source,
        supportStatus: "DETECTED",
        observedAtBlock: blockNumber,
        discoverySource: "demo-manifest:erc721",
        confidence: 1,
        assetType: "ERC721",
        contractAddress: demoIncident.contracts.nft,
        tokenId: "1",
        name: "SAFEEXIT Demo NFT",
      }] : []),
    ],
    approvals: [
      {
        id: "approval:demo-attacker",
        chainId: demoIncident.chainId,
        ownerAddress: demoIncident.source,
        supportStatus: allowance === "0" ? "SUPPORTED" : "DETECTED",
        observedAtBlock: blockNumber,
        discoverySource: "demo-manifest:allowance",
        approvalType: "ERC20_ALLOWANCE",
        tokenAddress: demoIncident.contracts.token,
        spenderAddress: demoIncident.contracts.attackerSimulation,
        amount: allowance,
      },
    ],
    warnings: [],
  },
  plan: {
    id: "plan:demo-31337",
    incidentId: demoIncident.id,
    version: 1,
    policyVersion: "phase-7-demo-1",
    chainId: demoIncident.chainId,
    sourceAddress: demoIncident.source,
    destinationAddress: demoIncident.destination,
    observedAtBlock: blockNumber,
    status: runtime?.actualState === "RESCUED" ? "COMPLETED" : "READY",
    actions,
    omissions: [],
    integrityHash: planHash,
    createdAt: observedAt,
  },
  simulations: actions.map((action, index) => ({
    id: `simulation:demo:${index + 1}`,
    planId: "plan:demo-31337",
    actionId: action.id,
    providerId: "foundry-demo-fixture",
    status: "SUCCEEDED",
    planHash,
    observedAtBlock: blockNumber,
    gasEstimate: runtime?.report?.simulation.actions.find((result) => result.id === action.id)?.gasUsed,
    expectedEffects: action.expectedEffects,
    assetChanges: [],
    warnings: ["Fixture result; no production simulation provider is configured."],
    simulatedAt: observedAt,
    expiresAt,
  })),
  status: {
    incidentId: demoIncident.id,
    status: incidentStatus,
    completedActionIds,
    failedActionIds,
    transactionHashes,
    observedAt,
  },
  });
}

export const demoAiContext = createDemoAiContext();
