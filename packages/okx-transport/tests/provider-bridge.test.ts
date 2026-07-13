import { describe, expect, it, vi } from "vitest";

import {
  SIGNING_PACKAGE_EIP712_TYPES,
  type AgentServiceJob,
  type BuyerExecutionReport,
  type SigningPackage,
} from "@safeexit/agent-service";
import {
  evmAddressSchema,
  type Incident,
  type RescuePlan,
  type WalletScan,
} from "@safeexit/shared";

import {
  OKX_A2A_XLAYER_MAINNET_CHAIN_ID,
  OKX_A2A_XLAYER_TESTNET_CHAIN_ID,
  OkxA2AProviderBridge,
  SAFEEXIT_AUTHORIZATION_STATEMENT,
  okxA2ATaskRequestSchema,
  okxX402PrepareRequestSchema,
  type OkxA2ATaskRequest,
  type SafeExitAgentLifecyclePort,
} from "../src";

const source = evmAddressSchema.parse("0x70997970C51812dc3A010C7d01b50e0d17dc79C8");
const destination = evmAddressSchema.parse("0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65");
const token = evmAddressSchema.parse("0x5FbDB2315678afecb367f032d93F642f64180aa3");
const now = "2026-07-13T06:00:00.000Z";
const planHash = `0x${"3".repeat(64)}`;
const txHash = `0x${"a".repeat(64)}`;

const incident: Incident = {
  id: "incident:test",
  chainId: 31_337,
  sourceAddress: source,
  destinationAddress: destination,
  status: "RECEIVED",
  ownershipAttestation: {
    accepted: true,
    statementVersion: "safeexit-okx-a2a-auth-v1",
    attestedAt: now,
  },
  createdAt: now,
  updatedAt: now,
};

const scan: WalletScan = {
  id: "scan:test",
  incidentId: incident.id,
  chainId: incident.chainId,
  address: source,
  status: "COMPLETE",
  providerId: "test-scanner",
  observedAtBlock: "12",
  observedAt: now,
  assets: [{
    id: "asset:test",
    chainId: incident.chainId,
    ownerAddress: source,
    supportStatus: "DETECTED",
    observedAtBlock: "12",
    discoverySource: "test-manifest",
    confidence: 1,
    assetType: "ERC20",
    contractAddress: token,
    name: "Test Token",
    symbol: "TEST",
    decimals: 18,
    balance: "100",
  }],
  approvals: [],
  warnings: [],
};

const plan: RescuePlan = {
  id: "plan:test",
  incidentId: incident.id,
  version: 1,
  policyVersion: "test-1",
  chainId: incident.chainId,
  sourceAddress: source,
  destinationAddress: destination,
  observedAtBlock: scan.observedAtBlock,
  status: "READY",
  actions: [{
    id: "action:transfer",
    chainId: incident.chainId,
    sourceAddress: source,
    dependencies: [],
    evidenceIds: ["asset:test"],
    expectedEffects: [{
      effectType: "ASSET_TRANSFERRED",
      assetId: "asset:test",
      description: "Move the test token to the confirmed destination.",
    }],
    riskLevel: "MEDIUM",
    supportStatus: "SUPPORTED",
    simulationStatus: "PASSED",
    actionType: "TRANSFER_ERC20",
    parameters: { tokenAddress: token, recipient: destination, amount: "100" },
  }],
  omissions: [],
  integrityHash: planHash,
  createdAt: now,
};

const signingPackage: SigningPackage = {
  schemaVersion: "safeexit-signing-package-v1",
  packageId: "signing-package:test",
  jobId: "job:test",
  incidentId: incident.id,
  planId: plan.id,
  planHash,
  actionId: "action:transfer",
  route: "ERC2612_PERMIT_ATOMIC_BATCH",
  chainId: incident.chainId,
  sourceAddress: source,
  destinationAddress: destination,
  observedAtBlock: plan.observedAtBlock,
  expiresAt: "2026-07-13T06:05:00.000Z",
  tokenAddress: token,
  amount: "100",
  sourceSigningRequests: [{
    id: "source-permit",
    signer: source,
    method: "EIP712",
    rpcMethod: "eth_signTypedData_v4",
    typedData: {
      primaryType: "Permit",
      types: {
        EIP712Domain: [...SIGNING_PACKAGE_EIP712_TYPES.EIP712Domain],
        Permit: [...SIGNING_PACKAGE_EIP712_TYPES.ERC2612Permit],
      },
      domain: {
        name: "Test Token",
        version: "1",
        chainId: incident.chainId,
        verifyingContract: token,
      },
      message: {
        owner: source,
        spender: destination,
        value: "100",
        nonce: "0",
        deadline: "1783922700",
      },
    },
  }],
  destinationSettlement: {
    executor: destination,
    payer: "DESTINATION",
    assembly: "BUYER_LOCAL_RUNTIME",
    atomicRequired: true,
    operations: ["PERMIT_ERC2612", "TRANSFER_FROM_ERC20"],
  },
  simulation: {
    resultId: "simulation:test",
    providerId: "test-simulator",
    status: "SUCCEEDED",
    expiresAt: "2026-07-13T06:06:00.000Z",
  },
  policy: {
    sourceSignsLocally: true,
    destinationPaysSettlement: true,
    privateCredentialsAccepted: false,
    signaturesReturnedToSafeExit: false,
    arbitraryCallsAllowed: false,
    postSignatureSimulationRequired: true,
  },
};

const waitingJob: AgentServiceJob = {
  id: "job:test",
  requestId: "okx:5196:market-job-1",
  service: "safeexit-incident-response",
  status: "WAITING_FOR_USER",
  incident,
  scan,
  plan,
  simulation: {
    status: "SUCCEEDED",
    providerId: "test-simulator",
    results: [{
      id: "simulation:test",
      planId: plan.id,
      actionId: "action:transfer",
      providerId: "test-simulator",
      status: "SUCCEEDED",
      planHash,
      observedAtBlock: plan.observedAtBlock,
      expectedEffects: plan.actions[0]?.expectedEffects ?? [],
      assetChanges: [],
      warnings: [],
      simulatedAt: now,
      expiresAt: "2026-07-13T06:06:00.000Z",
    }],
    executableActionIds: ["action:transfer"],
    excludedActionIds: [],
  },
  history: [
    { sequence: 0, from: null, to: "RECEIVED", reason: "JOB_CREATED", at: now },
    { sequence: 1, from: "RECEIVED", to: "ANALYSING", reason: "ANALYSIS_STARTED", at: now },
    { sequence: 2, from: "ANALYSING", to: "PLAN_READY", reason: "PLAN_GENERATED", at: now },
    { sequence: 3, from: "PLAN_READY", to: "WAITING_FOR_USER", reason: "SIMULATION_READY", at: now },
  ],
  revision: 3,
  createdAt: now,
  updatedAt: now,
};

const report: BuyerExecutionReport = {
  schemaVersion: "safeexit-buyer-report-v1",
  packageId: signingPackage.packageId,
  jobId: waitingJob.id,
  incidentId: incident.id,
  planId: plan.id,
  planHash,
  actionId: "action:transfer",
  route: signingPackage.route,
  chainId: incident.chainId,
  sourceAddress: source,
  destinationAddress: destination,
  status: "COMPLETED",
  simulationProviderId: "buyer-local-eth-simulate-v1",
  simulatedAt: now,
  transactionHashes: [txHash],
  completedAt: now,
};

const completedJob: AgentServiceJob = {
  ...waitingJob,
  status: "COMPLETED",
  signingPackage,
  monitor: {
    phase: "COMPLETED",
    completedActionIds: ["action:transfer"],
    failedActionIds: [],
    transactionHashes: [txHash],
    observedAt: now,
  },
  history: [
    ...waitingJob.history,
    { sequence: 4, from: "WAITING_FOR_USER", to: "SIGNING", reason: "SIGNING_OBSERVED", at: now },
    { sequence: 5, from: "SIGNING", to: "EXECUTING", reason: "EXECUTION_OBSERVED", at: now },
    { sequence: 6, from: "EXECUTING", to: "COMPLETED", reason: "RESCUE_COMPLETED", at: now },
  ],
  revision: 6,
};

const request: OkxA2ATaskRequest = {
  schemaVersion: "safeexit-okx-a2a-v1",
  transportMode: "SAFEEXIT_NORMALIZED",
  okxJobId: "market-job-1",
  providerAgentId: "5196",
  buyerAgentId: "100",
  service: "compromised-wallet-rescue",
  walletContext: {
    chainId: incident.chainId,
    sourceAddress: source,
    destinationAddress: destination,
  },
  authorization: { statement: SAFEEXIT_AUTHORIZATION_STATEMENT, confirmedAt: now },
};

function lifecycle(): SafeExitAgentLifecyclePort {
  return {
    createIncident: vi.fn(async () => waitingJob),
    analyseIncident: vi.fn(async () => waitingJob),
    generatePlan: vi.fn(async () => waitingJob),
    simulatePlan: vi.fn(async () => waitingJob),
    getSigningPackage: vi.fn(async () => signingPackage),
    getJob: vi.fn(async () => ({ ...waitingJob, signingPackage })),
    recordBuyerExecutionReport: vi.fn(async () => completedJob),
  };
}

describe("OKX A2A provider bridge", () => {
  it("requires the exact ownership statement and rejects undeclared credentials", () => {
    expect(() => okxA2ATaskRequestSchema.parse({
      ...request,
      authorization: { ...request.authorization, statement: "I own it" },
    })).toThrow();
    expect(() => okxA2ATaskRequestSchema.parse({ ...request, privateKey: "0xsecret" })).toThrow();
  });

  it("requires a bounded explicit asset manifest for testnet and accepts X Layer mainnet batches", () => {
    const testnetRequest = {
      ...request,
      walletContext: {
        ...request.walletContext,
        chainId: OKX_A2A_XLAYER_TESTNET_CHAIN_ID,
      },
    };
    expect(() => okxA2ATaskRequestSchema.parse(testnetRequest)).toThrow(
      "explicit asset manifest",
    );
    expect(okxA2ATaskRequestSchema.parse({
      ...testnetRequest,
      assetManifest: { erc20TokenAddresses: [token] },
    }).assetManifest?.erc20TokenAddresses).toEqual([token]);
    expect(okxA2ATaskRequestSchema.parse({
      ...request,
      walletContext: {
        ...request.walletContext,
        chainId: OKX_A2A_XLAYER_MAINNET_CHAIN_ID,
      },
      assetManifest: {
        erc20TokenAddresses: [token],
        erc721Assets: [{ collectionAddress: destination, tokenId: "42" }],
      },
    }).assetManifest?.erc721Assets).toEqual([
      { collectionAddress: destination, tokenId: "42" },
    ]);
  });

  it("binds the canonical testnet manifest to the persisted incident scope", async () => {
    const bridge = new OkxA2AProviderBridge(
      "5196",
      () => new Date(now),
      undefined,
      [OKX_A2A_XLAYER_TESTNET_CHAIN_ID],
    );
    const versions: string[] = [];
    for (const tokenAddress of [token, destination]) {
      const service = lifecycle();
      await expect(bridge.prepareSigningDeliverable(service, {
        ...request,
        walletContext: {
          ...request.walletContext,
          chainId: OKX_A2A_XLAYER_TESTNET_CHAIN_ID,
        },
        assetManifest: {
          erc20TokenAddresses: [tokenAddress],
          erc721Assets: [],
          erc1155Assets: [],
        },
      })).rejects.toThrow("outside the normalized task scope");
      const createIncident = vi.mocked(service.createIncident);
      const input = createIncident.mock.calls[0]?.[0];
      versions.push(input?.incident?.ownershipAttestation.statementVersion ?? "");
    }

    expect(versions[0]).toMatch(/^safeexit-okx-a2a-auth-v1-[a-f0-9]{7}$/);
    expect(versions[1]).toMatch(/^safeexit-okx-a2a-auth-v1-[a-f0-9]{7}$/);
    expect(versions[0]).not.toBe(versions[1]);
  });

  it("prepares a strict signing deliverable without source signatures", async () => {
    const bridge = new OkxA2AProviderBridge("5196", () => new Date(now), undefined, [31_337]);
    const result = await bridge.prepareSigningDeliverable(lifecycle(), request);

    expect(result.safeExitJobId).toBe("job:test");
    expect(result.signingPackage.route).toBe("ERC2612_PERMIT_ATOMIC_BATCH");
    expect(result.executionRequirements.sourceSignaturesMustNotBeReturned).toBe(true);
    expect(JSON.stringify(result)).not.toContain("signature\"");
  });

  it("prepares a paid direct deliverable without a conversational task round-trip", async () => {
    const bridge = new OkxA2AProviderBridge("5196", () => new Date(now), undefined, [31_337]);
    const service = lifecycle();
    const paidRequest = okxX402PrepareRequestSchema.parse({
      schemaVersion: "safeexit-okx-x402-v1",
      transportMode: "OKX_X402",
      requestId: "paid-request-1",
      buyerAgentId: "100",
      service: "compromised-wallet-rescue",
      walletContext: request.walletContext,
      authorization: request.authorization,
    });

    const result = await bridge.preparePaidSigningDeliverable(service, paidRequest);

    expect(result.transportMode).toBe("OKX_X402");
    expect(result.requestId).toBe("paid-request-1");
    expect(result.signingPackage).toEqual(signingPackage);
    expect(vi.mocked(service.createIncident).mock.calls[0]?.[0].requestId).toBe(
      "okx:5196:x402:paid-request-1",
    );
  });

  it("rejects credentials and provider overrides on paid direct requests", () => {
    const base = {
      schemaVersion: "safeexit-okx-x402-v1",
      transportMode: "OKX_X402",
      requestId: "paid-request-1",
      service: "compromised-wallet-rescue",
      walletContext: request.walletContext,
      authorization: request.authorization,
    };
    expect(() => okxX402PrepareRequestSchema.parse({
      ...base,
      privateKey: "0xsecret",
    })).toThrow();
    expect(() => okxX402PrepareRequestSchema.parse({
      ...base,
      providerAgentId: "9999",
    })).toThrow();
  });

  it("rejects a task targeting another provider agent", async () => {
    const bridge = new OkxA2AProviderBridge("5196", () => new Date(now), undefined, [31_337]);
    await expect(bridge.prepareSigningDeliverable(lifecycle(), {
      ...request,
      providerAgentId: "9999",
    })).rejects.toThrow("does not target this SAFEEXIT provider");
  });

  it("accepts only a receipt report bound to the original OKX task", async () => {
    const bridge = new OkxA2AProviderBridge("5196", () => new Date(now), undefined, [31_337]);
    const result = await bridge.recordBuyerReport(lifecycle(), {
      schemaVersion: "safeexit-okx-a2a-v1",
      transportMode: "SAFEEXIT_NORMALIZED",
      okxJobId: request.okxJobId,
      providerAgentId: request.providerAgentId,
      safeExitJobId: waitingJob.id,
      report,
    });

    expect(result.status).toBe("COMPLETED");
    expect(result.transactionHashes).toEqual([txHash]);
    expect(result.verification.sourceSignaturesReceivedBySafeExit).toBe(false);
  });

  it("rejects stale authorization and an unsupported production chain", async () => {
    const bridge = new OkxA2AProviderBridge("5196", () => new Date(now));
    await expect(bridge.prepareSigningDeliverable(lifecycle(), request)).rejects.toThrow(
      "chain is not enabled",
    );
    const localBridge = new OkxA2AProviderBridge(
      "5196",
      () => new Date(now),
      undefined,
      [31_337],
    );
    await expect(localBridge.prepareSigningDeliverable(lifecycle(), {
      ...request,
      authorization: {
        ...request.authorization,
        confirmedAt: "2026-07-11T06:00:00.000Z",
      },
    })).rejects.toThrow("outside the accepted time window");
  });
});
