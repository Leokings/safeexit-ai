import { describe, expect, it, vi } from "vitest";

import { anvilLocalConfig } from "@safeexit/chain";
import { evmAddressSchema } from "@safeexit/shared";

import {
  DeterministicWalletScanner,
  scannerStatusDescriptions,
  type StandardReadClient,
} from "../src";

const ownerAddress = evmAddressSchema.parse(
  "0x1111111111111111111111111111111111111111",
);
const otherOwner = evmAddressSchema.parse(
  "0x2222222222222222222222222222222222222222",
);
const erc20Address = evmAddressSchema.parse(
  "0x3333333333333333333333333333333333333333",
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
const permit2Address = evmAddressSchema.parse(
  "0x8888888888888888888888888888888888888888",
);

function createMockReader(
  overrides: Partial<StandardReadClient> = {},
): StandardReadClient {
  return {
    id: "mock-anvil",
    chainId: 31_337,
    getBlockNumber: vi.fn(async () => 100n),
    getNativeBalance: vi.fn(async () => 5_000_000_000_000_000n),
    getErc20Balance: vi.fn(async () => 1_000_000n),
    getErc721Owner: vi.fn(async () => ownerAddress),
    getErc1155Balance: vi.fn(async () => 3n),
    getErc20Allowance: vi.fn(async () => 500_000n),
    getNftOperatorApproval: vi.fn(async () => true),
    ...overrides,
  };
}

function createScanner(reader: StandardReadClient) {
  return new DeterministicWalletScanner({
    config: anvilLocalConfig,
    reader,
    clock: () => new Date("2026-07-11T12:00:00.000Z"),
  });
}

const completeManifest = {
  erc20Assets: [
    {
      tokenAddress: erc20Address,
      name: "Demo USD",
      symbol: "DUSD",
      decimals: 6,
    },
  ],
  erc721Assets: [
    {
      collectionAddress: erc721Address,
      tokenId: 7n,
      name: "Demo Pass",
    },
  ],
  erc1155Assets: [
    {
      collectionAddress: erc1155Address,
      tokenId: 9n,
    },
  ],
  erc20Allowances: [
    {
      tokenAddress: erc20Address,
      spenderAddress,
    },
  ],
  nftOperatorApprovals: [
    {
      standard: "ERC721" as const,
      collectionAddress: erc721Address,
      operatorAddress,
    },
  ],
};

describe("deterministic wallet scanner", () => {
  it("reads native, token, NFT, allowance, and operator state from one pinned block", async () => {
    const reader = createMockReader();
    const scanner = createScanner(reader);

    const report = await scanner.scan({
      incidentId: "incident-1",
      chainId: 31_337,
      address: ownerAddress,
      manifest: completeManifest,
    });

    expect(report.scan.status).toBe("COMPLETE");
    expect(report.scan.observedAtBlock).toBe("100");
    expect(report.scan.observedAt).toBe("2026-07-11T12:00:00.000Z");
    expect(report.scan.assets.map((asset) => asset.assetType)).toEqual([
      "NATIVE",
      "ERC20",
      "ERC721",
      "ERC1155",
    ]);
    expect(report.scan.approvals.map((approval) => approval.approvalType)).toEqual([
      "ERC20_ALLOWANCE",
      "NFT_OPERATOR",
    ]);
    expect(report.findings).toHaveLength(6);
    expect(report.findings.every((finding) => finding.status === "DETECTED")).toBe(
      true,
    );

    expect(reader.getBlockNumber).toHaveBeenCalledOnce();
    expect(reader.getNativeBalance).toHaveBeenCalledWith(ownerAddress, 100n);
    expect(reader.getErc20Balance).toHaveBeenCalledWith(
      erc20Address,
      ownerAddress,
      100n,
    );
    expect(reader.getErc721Owner).toHaveBeenCalledWith(erc721Address, 7n, 100n);
    expect(reader.getErc1155Balance).toHaveBeenCalledWith(
      erc1155Address,
      ownerAddress,
      9n,
      100n,
    );
    expect(reader.getErc20Allowance).toHaveBeenCalledWith(
      erc20Address,
      ownerAddress,
      spenderAddress,
      100n,
    );
    expect(reader.getNftOperatorApproval).toHaveBeenCalledWith(
      erc721Address,
      ownerAddress,
      operatorAddress,
      100n,
    );
  });

  it("reports supported negative reads without inventing assets or approvals", async () => {
    const reader = createMockReader({
      getNativeBalance: vi.fn(async () => 0n),
      getErc20Balance: vi.fn(async () => 0n),
      getErc721Owner: vi.fn(async () => otherOwner),
      getErc1155Balance: vi.fn(async () => 0n),
      getErc20Allowance: vi.fn(async () => 0n),
      getNftOperatorApproval: vi.fn(async () => false),
    });

    const report = await createScanner(reader).scan({
      incidentId: "incident-2",
      chainId: 31_337,
      address: ownerAddress,
      manifest: completeManifest,
      observedAtBlock: 99n,
    });

    expect(report.scan.status).toBe("COMPLETE");
    expect(report.scan.assets).toEqual([]);
    expect(report.scan.approvals).toEqual([]);
    expect(report.findings.every((finding) => finding.status === "SUPPORTED")).toBe(
      true,
    );
    expect(report.findings.every((finding) => finding.detected === false)).toBe(true);
    expect(reader.getBlockNumber).not.toHaveBeenCalled();
  });

  it("marks failed reads unknown instead of treating them as zero balances", async () => {
    const reader = createMockReader({
      getErc20Balance: vi.fn(async () => {
        throw new Error("execution reverted");
      }),
    });

    const report = await createScanner(reader).scan({
      incidentId: "incident-3",
      chainId: 31_337,
      address: ownerAddress,
      manifest: {
        erc20Assets: completeManifest.erc20Assets,
      },
    });

    const erc20Finding = report.findings.find(
      (finding) => finding.category === "ERC20_ASSET",
    );
    expect(report.scan.status).toBe("PARTIAL");
    expect(report.scan.assets.some((asset) => asset.assetType === "ERC20")).toBe(false);
    expect(erc20Finding).toMatchObject({
      status: "UNKNOWN",
      detected: null,
    });
    expect(erc20Finding?.reason).toContain("execution reverted");
  });

  it("returns an explicit unsupported finding for unverified Permit2 scanning", async () => {
    const report = await createScanner(createMockReader()).scan({
      incidentId: "incident-4",
      chainId: 31_337,
      address: ownerAddress,
      manifest: {
        permit2Approvals: [
          {
            permit2Address,
            tokenAddress: erc20Address,
            spenderAddress,
          },
        ],
      },
    });

    expect(report.scan.status).toBe("PARTIAL");
    expect(report.scan.approvals).toEqual([]);
    expect(report.findings).toContainEqual(
      expect.objectContaining({
        category: "PERMIT2_APPROVAL",
        status: "UNSUPPORTED",
        detected: null,
      }),
    );
  });

  it("rejects a request whose chain does not match the configured reader", async () => {
    await expect(
      createScanner(createMockReader()).scan({
        incidentId: "incident-5",
        chainId: 10_001,
        address: ownerAddress,
      }),
    ).rejects.toThrow("Scanner is not configured for chain ID 10001");
  });

  it("scopes evidence IDs to the incident scan", async () => {
    const scanner = createScanner(createMockReader());
    const first = await scanner.scan({
      incidentId: "incident-a",
      chainId: 31_337,
      address: ownerAddress,
      observedAtBlock: 100n,
    });
    const second = await scanner.scan({
      incidentId: "incident-b",
      chainId: 31_337,
      address: ownerAddress,
      observedAtBlock: 100n,
    });

    expect(first.scan.assets[0]?.id).not.toBe(second.scan.assets[0]?.id);
    expect(first.scan.assets[0]?.id).toMatch(/^evidence:0x[a-f0-9]{64}$/);
  });

  it("defines all four scanner state meanings", () => {
    expect(Object.keys(scannerStatusDescriptions).sort()).toEqual([
      "DETECTED",
      "SUPPORTED",
      "UNKNOWN",
      "UNSUPPORTED",
    ]);
  });
});
