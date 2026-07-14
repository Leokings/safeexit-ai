import { encodeAbiParameters } from "viem";
import { describe, expect, it, vi } from "vitest";

import { DeterministicRescuePlanner } from "@safeexit/planner";
import {
  evmAddressSchema,
  rescueActionSchema,
  walletScanSchema,
  type RescueAction,
} from "@safeexit/shared";

import {
  LocalSimulationProvider,
  OfficialDocsRequiredSimulationProvider,
  createSimulationResult,
  simulateRescuePlan,
  type LocalSimulationClient,
  type SimulationProvider,
  type SimulationRequest,
} from "../src";

const sourceAddress = evmAddressSchema.parse(
  "0x1111111111111111111111111111111111111111",
);
const destinationAddress = evmAddressSchema.parse(
  "0x2222222222222222222222222222222222222222",
);
const tokenAddress = evmAddressSchema.parse(
  "0x3333333333333333333333333333333333333333",
);
const spenderAddress = evmAddressSchema.parse(
  "0x4444444444444444444444444444444444444444",
);
const adapterAddress = evmAddressSchema.parse(
  "0x5555555555555555555555555555555555555555",
);
const planHash = `0x${"a".repeat(64)}` as const;
const now = new Date("2026-07-11T12:00:00.000Z");

const erc20TransferAction = rescueActionSchema.parse({
  id: "action-transfer-token",
  chainId: 31_337,
  sourceAddress,
  dependencies: [],
  evidenceIds: ["asset-token"],
  expectedEffects: [
    {
      effectType: "ASSET_TRANSFERRED",
      assetId: "asset-token",
      description: "Move the token to the confirmed destination.",
    },
  ],
  riskLevel: "HIGH",
  estimatedValueUsd: 1_000,
  supportStatus: "SUPPORTED",
  simulationStatus: "NOT_SIMULATED",
  actionType: "TRANSFER_ERC20",
  parameters: {
    tokenAddress,
    recipient: destinationAddress,
    amount: "1000000",
  },
});

function requestFor(action: RescueAction): SimulationRequest {
  return {
    planId: "plan-1",
    planHash,
    action,
    observedAtBlock: "100",
  };
}

function createMockClient(
  overrides: Partial<LocalSimulationClient> = {},
): LocalSimulationClient {
  return {
    id: "mock-anvil",
    chainId: 31_337,
    call: vi.fn(async () => encodeAbiParameters([{ type: "bool" }], [true])),
    estimateGas: vi.fn(async () => 50_000n),
    getBalance: vi.fn(async () => 1_000_000_000_000_000_000n),
    getGasPrice: vi.fn(async () => 1_000_000_000n),
    ...overrides,
  };
}

function createLocalProvider(client: LocalSimulationClient) {
  return new LocalSimulationProvider({
    id: "local-anvil-call",
    kind: "LOCAL_RPC",
    client,
    clock: () => now,
  });
}

describe("LocalSimulationProvider", () => {
  it("captures success, gas, and inferred ERC-20 transfer effects", async () => {
    const client = createMockClient();
    const result = await createLocalProvider(client).simulate(
      requestFor(erc20TransferAction),
    );

    expect(result.status).toBe("SUCCEEDED");
    expect(result.gasEstimate).toBe("50000");
    expect(result.failureReason).toBeUndefined();
    expect(result.assetChanges).toEqual([
      {
        assetType: "ERC20",
        contractAddress: tokenAddress,
        account: sourceAddress,
        direction: "DEBIT",
        amount: "1000000",
      },
      {
        assetType: "ERC20",
        contractAddress: tokenAddress,
        account: destinationAddress,
        direction: "CREDIT",
        amount: "1000000",
      },
    ]);
    expect(result.warnings[0]).toContain("not a full state diff");
    expect(client.call).toHaveBeenCalledWith(
      expect.objectContaining({
        account: sourceAddress,
        to: tokenAddress,
        blockNumber: 100n,
      }),
    );
  });

  it("can validate a destination-paid call without source-funded gas estimation", async () => {
    const client = createMockClient();
    const provider = new LocalSimulationProvider({
      id: "mainnet-permit-preflight",
      kind: "PRODUCTION_RPC",
      client,
      estimateGas: false,
      clock: () => now,
    });

    const result = await provider.simulate(requestFor(erc20TransferAction));

    expect(result.status).toBe("SUCCEEDED");
    expect(result.gasEstimate).toBeUndefined();
    expect(client.estimateGas).not.toHaveBeenCalled();
  });

  it("captures a revert reason and emits no balance effects", async () => {
    const client = createMockClient({
      call: vi.fn(async () => {
        throw new Error("execution reverted: NotOwner");
      }),
    });
    const result = await createLocalProvider(client).simulate(
      requestFor(erc20TransferAction),
    );

    expect(result.status).toBe("REVERTED");
    expect(result.failureReason).toContain("NotOwner");
    expect(result.gasEstimate).toBeUndefined();
    expect(result.assetChanges).toEqual([]);
    expect(client.estimateGas).not.toHaveBeenCalled();
  });

  it("reserves estimated gas before simulating a native transfer", async () => {
    const nativeAction = rescueActionSchema.parse({
      ...erc20TransferAction,
      id: "action-transfer-native",
      evidenceIds: ["asset-native"],
      actionType: "TRANSFER_NATIVE",
      parameters: {
        recipient: destinationAddress,
        maximumAmount: "1000000000000000000",
        amountStrategy: "MAX_MINUS_GAS_RESERVE",
      },
    });
    const client = createMockClient({
      call: vi.fn(async () => "0x" as const),
      estimateGas: vi.fn(async () => 21_000n),
    });
    const result = await createLocalProvider(client).simulate(requestFor(nativeAction));

    expect(result.status).toBe("SUCCEEDED");
    expect(result.gasEstimate).toBe("21000");
    expect(result.assetChanges[0]).toMatchObject({
      assetType: "NATIVE",
      direction: "DEBIT",
      amount: "999979000000000000",
    });
    expect(client.call).toHaveBeenCalledWith(
      expect.objectContaining({ value: 999_979_000_000_000_000n }),
    );
  });

  it("marks adapter actions unsupported without a reviewed resolver", async () => {
    const adapterAction = rescueActionSchema.parse({
      ...erc20TransferAction,
      id: "action-adapter",
      evidenceIds: ["adapter-evidence"],
      actionType: "CUSTOM_SUPPORTED_ADAPTER",
      parameters: {
        adapterId: "demo-adapter",
        contractAddress: adapterAddress,
        operationId: "reviewed-operation",
      },
    });
    const result = await createLocalProvider(createMockClient()).simulate(
      requestFor(adapterAction),
    );

    expect(result.status).toBe("UNSUPPORTED");
    expect(result.failureReason).toContain("reviewed local simulation resolver");
  });
});

describe("production simulation adapter placeholder", () => {
  it("requires official documentation without inventing an API", async () => {
    const provider = new OfficialDocsRequiredSimulationProvider({
      id: "future-production-provider",
      displayName: "Future production simulator",
      clock: () => now,
    });
    const result = await provider.simulate(requestFor(erc20TransferAction));

    expect(provider.officialDocsRequired).toBe(true);
    expect(result.status).toBe("UNSUPPORTED");
    expect(result.failureReason).toContain("official documentation");
  });
});

describe("simulateRescuePlan", () => {
  it("excludes a failed action and its dependent revocation by default", async () => {
    const scan = walletScanSchema.parse({
      id: "scan-plan-simulation",
      incidentId: "incident-plan-simulation",
      chainId: 31_337,
      address: sourceAddress,
      status: "COMPLETE",
      providerId: "mock-anvil",
      observedAtBlock: "100",
      observedAt: now.toISOString(),
      assets: [
        {
          id: "asset-plan-token",
          chainId: 31_337,
          ownerAddress: sourceAddress,
          supportStatus: "SUPPORTED",
          observedAtBlock: "100",
          discoverySource: "mock-anvil",
          confidence: 1,
          assetType: "ERC20",
          contractAddress: tokenAddress,
          name: "Demo Token",
          symbol: "DEMO",
          decimals: 18,
          balance: "1000",
        },
      ],
      approvals: [
        {
          id: "approval-plan-token",
          chainId: 31_337,
          ownerAddress: sourceAddress,
          supportStatus: "SUPPORTED",
          observedAtBlock: "100",
          discoverySource: "mock-anvil",
          approvalType: "ERC20_ALLOWANCE",
          tokenAddress,
          spenderAddress,
          amount: "1000",
        },
      ],
      warnings: [],
    });
    const plan = new DeterministicRescuePlanner({ clock: () => now }).plan({
      incidentId: "incident-plan-simulation",
      destinationAddress,
      policyVersion: "phase-4-test",
      scan,
    });
    const simulate = vi.fn(async (request: SimulationRequest) =>
      createSimulationResult({
        providerId: "always-revert",
        request,
        status: "REVERTED",
        failureReason: "execution reverted: transfer blocked",
        clock: () => now,
        ttlMs: 60_000,
      }),
    );
    const provider: SimulationProvider = {
      id: "always-revert",
      kind: "LOCAL_RPC",
      officialDocsRequired: false,
      supports: vi.fn(async () => ({ supported: true })),
      simulate,
    };

    const report = await simulateRescuePlan(plan, provider, { clock: () => now });

    expect(report.status).toBe("FAILED");
    expect(report.executableActions).toEqual([]);
    expect(report.results.map((result) => result.status)).toEqual([
      "REVERTED",
      "UNSUPPORTED",
    ]);
    expect(report.excludedActions).toHaveLength(2);
    expect(simulate).toHaveBeenCalledOnce();
  });
});
