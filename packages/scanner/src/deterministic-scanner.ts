import type { ChainAdapterConfig } from "@safeexit/chain";
import { keccak256, toBytes } from "viem";
import {
  walletScanSchema,
  type Approval,
  type Asset,
  type SupportStatus,
} from "@safeexit/shared";

import type { StandardReadClient } from "./reader";
import type {
  DeterministicScanReport,
  Erc1155AssetQuery,
  Erc1155AssetScanner,
  Erc20AllowanceQuery,
  Erc20AllowanceScanner,
  Erc20AssetQuery,
  Erc20AssetScanner,
  Erc721AssetQuery,
  Erc721AssetScanner,
  NativeBalanceScanner,
  NftOperatorApprovalQuery,
  NftOperatorApprovalScanner,
  Permit2ApprovalQuery,
  Permit2ApprovalScanner,
  ScannerBatchResult,
  ScannerFinding,
  StandardScanContext,
  WalletScanner,
  WalletScanRequest,
} from "./types";

const manifestScopeWarning =
  "Token, NFT, and approval discovery is limited to the explicit scan manifest.";

function scopedEvidenceId(scanId: string, evidenceId: string): string {
  return `evidence:${keccak256(toBytes(`${scanId}:${evidenceId}`))}`;
}

function errorReason(error: unknown): string {
  const message = error instanceof Error ? error.message : "Unknown read failure";
  return `Deterministic contract read failed: ${message}`.slice(0, 500);
}

function finding(
  category: ScannerFinding["category"],
  subject: string,
  observedAtBlock: bigint,
  evidenceSource: string,
  status: SupportStatus,
  detected: boolean | null,
  reason?: string,
): ScannerFinding {
  return {
    category,
    subject,
    status,
    detected,
    observedAtBlock: observedAtBlock.toString(),
    evidenceSource,
    ...(reason ? { reason } : {}),
  };
}

function batchStatus(findings: readonly ScannerFinding[]): SupportStatus {
  if (findings.some((item) => item.status === "UNKNOWN")) {
    return "UNKNOWN";
  }
  if (findings.some((item) => item.status === "UNSUPPORTED")) {
    return "UNSUPPORTED";
  }
  if (findings.some((item) => item.status === "DETECTED")) {
    return "DETECTED";
  }
  return "SUPPORTED";
}

export class DeterministicStandardScanner
  implements
    NativeBalanceScanner,
    Erc20AssetScanner,
    Erc721AssetScanner,
    Erc1155AssetScanner,
    Erc20AllowanceScanner,
    NftOperatorApprovalScanner
{
  constructor(
    private readonly config: ChainAdapterConfig,
    private readonly reader: StandardReadClient,
  ) {}

  async scanNativeBalance(
    context: StandardScanContext,
  ): Promise<ScannerBatchResult<Asset>> {
    const source = `${this.reader.id}:eth_getBalance`;
    const subject = `${context.chainId}:${context.ownerAddress}`;

    try {
      const balance = await this.reader.getNativeBalance(
        context.ownerAddress,
        context.observedAtBlock,
      );
      const detected = balance > 0n;
      const items: Asset[] = detected
        ? [
            {
              id: `asset:native:${subject}`,
              chainId: context.chainId,
              ownerAddress: context.ownerAddress,
              supportStatus: "SUPPORTED",
              observedAtBlock: context.observedAtBlock.toString(),
              discoverySource: source,
              confidence: 1,
              assetType: "NATIVE",
              symbol: this.config.chain.nativeCurrency.symbol,
              decimals: this.config.chain.nativeCurrency.decimals,
              balance: balance.toString(),
            },
          ]
        : [];
      const findings = [
        finding(
          "NATIVE_BALANCE",
          subject,
          context.observedAtBlock,
          source,
          detected ? "DETECTED" : "SUPPORTED",
          detected,
        ),
      ];

      return { status: batchStatus(findings), items, findings };
    } catch (error) {
      const findings = [
        finding(
          "NATIVE_BALANCE",
          subject,
          context.observedAtBlock,
          source,
          "UNKNOWN",
          null,
          errorReason(error),
        ),
      ];
      return { status: "UNKNOWN", items: [], findings };
    }
  }

  async scanErc20Assets(
    context: StandardScanContext,
    queries: readonly Erc20AssetQuery[],
  ): Promise<ScannerBatchResult<Asset>> {
    const source = `${this.reader.id}:erc20.balanceOf`;
    const results = await Promise.all(
      queries.map(async (query) => {
        try {
          const balance = await this.reader.getErc20Balance(
            query.tokenAddress,
            context.ownerAddress,
            context.observedAtBlock,
          );
          const detected = balance > 0n;
          const item: Asset | undefined = detected || query.includeZeroBalance
            ? {
                id: `asset:erc20:${query.tokenAddress}:${context.ownerAddress}`,
                chainId: context.chainId,
                ownerAddress: context.ownerAddress,
                supportStatus: "SUPPORTED",
                observedAtBlock: context.observedAtBlock.toString(),
                discoverySource: source,
                confidence: 1,
                assetType: "ERC20",
                contractAddress: query.tokenAddress,
                name: query.name,
                symbol: query.symbol,
                decimals: query.decimals,
                balance: balance.toString(),
              }
            : undefined;

          return {
            item,
            finding: finding(
              "ERC20_ASSET",
              query.tokenAddress,
              context.observedAtBlock,
              source,
              detected ? "DETECTED" : "SUPPORTED",
              detected,
            ),
          };
        } catch (error) {
          return {
            item: undefined,
            finding: finding(
              "ERC20_ASSET",
              query.tokenAddress,
              context.observedAtBlock,
              source,
              "UNKNOWN",
              null,
              errorReason(error),
            ),
          };
        }
      }),
    );
    const findings = results.map((result) => result.finding);
    const items = results.flatMap((result) => (result.item ? [result.item] : []));
    return { status: batchStatus(findings), items, findings };
  }

  async scanErc721Assets(
    context: StandardScanContext,
    queries: readonly Erc721AssetQuery[],
  ): Promise<ScannerBatchResult<Asset>> {
    const source = `${this.reader.id}:erc721.ownerOf`;
    const results = await Promise.all(
      queries.map(async (query) => {
        const subject = `${query.collectionAddress}:${query.tokenId}`;
        try {
          const owner = await this.reader.getErc721Owner(
            query.collectionAddress,
            query.tokenId,
            context.observedAtBlock,
          );
          const detected = owner.toLowerCase() === context.ownerAddress.toLowerCase();
          const item: Asset | undefined = detected
            ? {
                id: `asset:erc721:${subject}`,
                chainId: context.chainId,
                ownerAddress: context.ownerAddress,
                supportStatus: "SUPPORTED",
                observedAtBlock: context.observedAtBlock.toString(),
                discoverySource: source,
                confidence: 1,
                assetType: "ERC721",
                contractAddress: query.collectionAddress,
                tokenId: query.tokenId.toString(),
                ...(query.name ? { name: query.name } : {}),
              }
            : undefined;

          return {
            item,
            finding: finding(
              "ERC721_ASSET",
              subject,
              context.observedAtBlock,
              source,
              detected ? "DETECTED" : "SUPPORTED",
              detected,
            ),
          };
        } catch (error) {
          return {
            item: undefined,
            finding: finding(
              "ERC721_ASSET",
              subject,
              context.observedAtBlock,
              source,
              "UNKNOWN",
              null,
              errorReason(error),
            ),
          };
        }
      }),
    );
    const findings = results.map((result) => result.finding);
    const items = results.flatMap((result) => (result.item ? [result.item] : []));
    return { status: batchStatus(findings), items, findings };
  }

  async scanErc1155Assets(
    context: StandardScanContext,
    queries: readonly Erc1155AssetQuery[],
  ): Promise<ScannerBatchResult<Asset>> {
    const source = `${this.reader.id}:erc1155.balanceOf`;
    const results = await Promise.all(
      queries.map(async (query) => {
        const subject = `${query.collectionAddress}:${query.tokenId}`;
        try {
          const balance = await this.reader.getErc1155Balance(
            query.collectionAddress,
            context.ownerAddress,
            query.tokenId,
            context.observedAtBlock,
          );
          const detected = balance > 0n;
          const item: Asset | undefined = detected
            ? {
                id: `asset:erc1155:${subject}`,
                chainId: context.chainId,
                ownerAddress: context.ownerAddress,
                supportStatus: "SUPPORTED",
                observedAtBlock: context.observedAtBlock.toString(),
                discoverySource: source,
                confidence: 1,
                assetType: "ERC1155",
                contractAddress: query.collectionAddress,
                tokenId: query.tokenId.toString(),
                balance: balance.toString(),
              }
            : undefined;

          return {
            item,
            finding: finding(
              "ERC1155_ASSET",
              subject,
              context.observedAtBlock,
              source,
              detected ? "DETECTED" : "SUPPORTED",
              detected,
            ),
          };
        } catch (error) {
          return {
            item: undefined,
            finding: finding(
              "ERC1155_ASSET",
              subject,
              context.observedAtBlock,
              source,
              "UNKNOWN",
              null,
              errorReason(error),
            ),
          };
        }
      }),
    );
    const findings = results.map((result) => result.finding);
    const items = results.flatMap((result) => (result.item ? [result.item] : []));
    return { status: batchStatus(findings), items, findings };
  }

  async scanErc20Allowances(
    context: StandardScanContext,
    queries: readonly Erc20AllowanceQuery[],
  ): Promise<ScannerBatchResult<Approval>> {
    const source = `${this.reader.id}:erc20.allowance`;
    const results = await Promise.all(
      queries.map(async (query) => {
        const subject = `${query.tokenAddress}:${query.spenderAddress}`;
        try {
          const amount = await this.reader.getErc20Allowance(
            query.tokenAddress,
            context.ownerAddress,
            query.spenderAddress,
            context.observedAtBlock,
          );
          const detected = amount > 0n;
          const item: Approval | undefined = detected
            ? {
                id: `approval:erc20:${subject}:${context.ownerAddress}`,
                chainId: context.chainId,
                ownerAddress: context.ownerAddress,
                supportStatus: "SUPPORTED",
                observedAtBlock: context.observedAtBlock.toString(),
                discoverySource: source,
                approvalType: "ERC20_ALLOWANCE",
                tokenAddress: query.tokenAddress,
                spenderAddress: query.spenderAddress,
                amount: amount.toString(),
              }
            : undefined;

          return {
            item,
            finding: finding(
              "ERC20_ALLOWANCE",
              subject,
              context.observedAtBlock,
              source,
              detected ? "DETECTED" : "SUPPORTED",
              detected,
            ),
          };
        } catch (error) {
          return {
            item: undefined,
            finding: finding(
              "ERC20_ALLOWANCE",
              subject,
              context.observedAtBlock,
              source,
              "UNKNOWN",
              null,
              errorReason(error),
            ),
          };
        }
      }),
    );
    const findings = results.map((result) => result.finding);
    const items = results.flatMap((result) => (result.item ? [result.item] : []));
    return { status: batchStatus(findings), items, findings };
  }

  async scanNftOperatorApprovals(
    context: StandardScanContext,
    queries: readonly NftOperatorApprovalQuery[],
  ): Promise<ScannerBatchResult<Approval>> {
    const source = `${this.reader.id}:nft.isApprovedForAll`;
    const results = await Promise.all(
      queries.map(async (query) => {
        const subject = `${query.standard}:${query.collectionAddress}:${query.operatorAddress}`;
        try {
          const approved = await this.reader.getNftOperatorApproval(
            query.collectionAddress,
            context.ownerAddress,
            query.operatorAddress,
            context.observedAtBlock,
          );
          const item: Approval | undefined = approved
            ? {
                id: `approval:operator:${subject}:${context.ownerAddress}`,
                chainId: context.chainId,
                ownerAddress: context.ownerAddress,
                supportStatus: "SUPPORTED",
                observedAtBlock: context.observedAtBlock.toString(),
                discoverySource: source,
                approvalType: "NFT_OPERATOR",
                standard: query.standard,
                collectionAddress: query.collectionAddress,
                operatorAddress: query.operatorAddress,
                approved: true,
              }
            : undefined;

          return {
            item,
            finding: finding(
              "NFT_OPERATOR_APPROVAL",
              subject,
              context.observedAtBlock,
              source,
              approved ? "DETECTED" : "SUPPORTED",
              approved,
            ),
          };
        } catch (error) {
          return {
            item: undefined,
            finding: finding(
              "NFT_OPERATOR_APPROVAL",
              subject,
              context.observedAtBlock,
              source,
              "UNKNOWN",
              null,
              errorReason(error),
            ),
          };
        }
      }),
    );
    const findings = results.map((result) => result.finding);
    const items = results.flatMap((result) => (result.item ? [result.item] : []));
    return { status: batchStatus(findings), items, findings };
  }
}

export class UnsupportedPermit2ApprovalScanner implements Permit2ApprovalScanner {
  readonly id = "permit2-future-interface";

  async supports(): Promise<boolean> {
    return false;
  }

  async scanPermit2Approvals(
    context: StandardScanContext,
    queries: readonly Permit2ApprovalQuery[],
  ): Promise<ScannerBatchResult<Approval>> {
    const findings = queries.map((query) =>
      finding(
        "PERMIT2_APPROVAL",
        `${query.permit2Address}:${query.tokenAddress}:${query.spenderAddress}`,
        context.observedAtBlock,
        this.id,
        "UNSUPPORTED",
        null,
        "Permit2 scanning requires a verified chain deployment and is not implemented.",
      ),
    );

    return {
      status: findings.length > 0 ? "UNSUPPORTED" : "SUPPORTED",
      items: [],
      findings,
    };
  }
}

export type DeterministicWalletScannerOptions = {
  config: ChainAdapterConfig;
  reader: StandardReadClient;
  permit2Scanner?: Permit2ApprovalScanner;
  clock?: () => Date;
};

export class DeterministicWalletScanner implements WalletScanner {
  readonly id = "deterministic-standard-wallet-scanner";
  private readonly standardScanner: DeterministicStandardScanner;
  private readonly permit2Scanner: Permit2ApprovalScanner;
  private readonly clock: () => Date;

  constructor(private readonly options: DeterministicWalletScannerOptions) {
    this.standardScanner = new DeterministicStandardScanner(options.config, options.reader);
    this.permit2Scanner = options.permit2Scanner ?? new UnsupportedPermit2ApprovalScanner();
    this.clock = options.clock ?? (() => new Date());
  }

  async supports(chainId: number): Promise<boolean> {
    return (
      this.options.config.chain.id === chainId && this.options.reader.chainId === chainId
    );
  }

  async scan(request: WalletScanRequest): Promise<DeterministicScanReport> {
    if (!(await this.supports(request.chainId))) {
      throw new Error(`Scanner is not configured for chain ID ${request.chainId}`);
    }

    const observedAtBlock =
      request.observedAtBlock ?? (await this.options.reader.getBlockNumber());
    const context: StandardScanContext = {
      chainId: request.chainId,
      ownerAddress: request.address,
      observedAtBlock,
    };
    const manifest = request.manifest ?? {};

    const [native, erc20, erc721, erc1155, allowances, nftOperators, permit2] =
      await Promise.all([
        this.standardScanner.scanNativeBalance(context),
        this.standardScanner.scanErc20Assets(context, manifest.erc20Assets ?? []),
        this.standardScanner.scanErc721Assets(context, manifest.erc721Assets ?? []),
        this.standardScanner.scanErc1155Assets(context, manifest.erc1155Assets ?? []),
        this.standardScanner.scanErc20Allowances(
          context,
          manifest.erc20Allowances ?? [],
        ),
        this.standardScanner.scanNftOperatorApprovals(
          context,
          manifest.nftOperatorApprovals ?? [],
        ),
        this.permit2Scanner.scanPermit2Approvals(
          context,
          manifest.permit2Approvals ?? [],
        ),
      ]);

    const assetResults = [native, erc20, erc721, erc1155];
    const approvalResults = [allowances, nftOperators, permit2];
    const findings = [...assetResults, ...approvalResults].flatMap(
      (result) => result.findings,
    );
    const hasIncompleteReads = findings.some(
      (item) => item.status === "UNKNOWN" || item.status === "UNSUPPORTED",
    );
    const warnings = [
      manifestScopeWarning,
      ...findings.flatMap((item) =>
        item.reason && (item.status === "UNKNOWN" || item.status === "UNSUPPORTED")
          ? [item.reason]
          : [],
      ),
    ];

    const scanId = `scan:${request.incidentId}:${observedAtBlock}`;
    const scan = walletScanSchema.parse({
      id: scanId,
      incidentId: request.incidentId,
      chainId: request.chainId,
      address: request.address,
      status: hasIncompleteReads ? "PARTIAL" : "COMPLETE",
      providerId: this.options.reader.id,
      observedAtBlock: observedAtBlock.toString(),
      observedAt: this.clock().toISOString(),
      assets: assetResults.flatMap((result) =>
        result.items.map((item) => ({
          ...item,
          id: scopedEvidenceId(scanId, item.id),
        })),
      ),
      approvals: approvalResults.flatMap((result) =>
        result.items.map((item) => ({
          ...item,
          id: scopedEvidenceId(scanId, item.id),
        })),
      ),
      warnings,
    });

    return { scan, findings };
  }
}
