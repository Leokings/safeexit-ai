import type {
  Approval,
  Asset,
  EvmAddress,
  SupportStatus,
  WalletScan,
} from "@safeexit/shared";

export const scannerStatusDescriptions = {
  DETECTED: "A positive balance, ownership record, or active approval was read onchain.",
  SUPPORTED: "The deterministic scanner completed the requested standard read.",
  UNSUPPORTED: "No verified scanner implementation is enabled for this request.",
  UNKNOWN: "The scanner could not determine state from the configured read source.",
} as const satisfies Record<SupportStatus, string>;

export type ScanCategory =
  | "NATIVE_BALANCE"
  | "ERC20_ASSET"
  | "ERC721_ASSET"
  | "ERC1155_ASSET"
  | "ERC20_ALLOWANCE"
  | "NFT_OPERATOR_APPROVAL"
  | "PERMIT2_APPROVAL";

export type ScannerFinding = {
  category: ScanCategory;
  subject: string;
  status: SupportStatus;
  detected: boolean | null;
  observedAtBlock: string;
  evidenceSource: string;
  reason?: string;
};

export type ScannerBatchResult<T extends Asset | Approval> = {
  status: SupportStatus;
  items: readonly T[];
  findings: readonly ScannerFinding[];
};

export type StandardScanContext = {
  chainId: number;
  ownerAddress: EvmAddress;
  observedAtBlock: bigint;
};

export type Erc20AssetQuery = {
  tokenAddress: EvmAddress;
  name: string;
  symbol: string;
  decimals: number;
  /** Retain explicit user-requested assets even when their verified balance is zero. */
  includeZeroBalance?: boolean;
};

export type Erc721AssetQuery = {
  collectionAddress: EvmAddress;
  tokenId: bigint;
  name?: string;
};

export type Erc1155AssetQuery = {
  collectionAddress: EvmAddress;
  tokenId: bigint;
};

export type Erc20AllowanceQuery = {
  tokenAddress: EvmAddress;
  spenderAddress: EvmAddress;
};

export type NftOperatorApprovalQuery = {
  standard: "ERC721" | "ERC1155";
  collectionAddress: EvmAddress;
  operatorAddress: EvmAddress;
};

export type Permit2ApprovalQuery = {
  permit2Address: EvmAddress;
  tokenAddress: EvmAddress;
  spenderAddress: EvmAddress;
};

export type WalletScanManifest = {
  erc20Assets?: readonly Erc20AssetQuery[];
  erc721Assets?: readonly Erc721AssetQuery[];
  erc1155Assets?: readonly Erc1155AssetQuery[];
  erc20Allowances?: readonly Erc20AllowanceQuery[];
  nftOperatorApprovals?: readonly NftOperatorApprovalQuery[];
  permit2Approvals?: readonly Permit2ApprovalQuery[];
};

export type WalletScanRequest = {
  incidentId: string;
  chainId: number;
  address: EvmAddress;
  manifest?: WalletScanManifest;
  observedAtBlock?: bigint;
};

export type DeterministicScanReport = {
  scan: WalletScan;
  findings: readonly ScannerFinding[];
};

export interface NativeBalanceScanner {
  scanNativeBalance(context: StandardScanContext): Promise<ScannerBatchResult<Asset>>;
}

export interface Erc20AssetScanner {
  scanErc20Assets(
    context: StandardScanContext,
    queries: readonly Erc20AssetQuery[],
  ): Promise<ScannerBatchResult<Asset>>;
}

export interface Erc721AssetScanner {
  scanErc721Assets(
    context: StandardScanContext,
    queries: readonly Erc721AssetQuery[],
  ): Promise<ScannerBatchResult<Asset>>;
}

export interface Erc1155AssetScanner {
  scanErc1155Assets(
    context: StandardScanContext,
    queries: readonly Erc1155AssetQuery[],
  ): Promise<ScannerBatchResult<Asset>>;
}

export interface Erc20AllowanceScanner {
  scanErc20Allowances(
    context: StandardScanContext,
    queries: readonly Erc20AllowanceQuery[],
  ): Promise<ScannerBatchResult<Approval>>;
}

export interface NftOperatorApprovalScanner {
  scanNftOperatorApprovals(
    context: StandardScanContext,
    queries: readonly NftOperatorApprovalQuery[],
  ): Promise<ScannerBatchResult<Approval>>;
}

export interface Permit2ApprovalScanner {
  readonly id: string;
  supports(chainId: number): Promise<boolean>;
  scanPermit2Approvals(
    context: StandardScanContext,
    queries: readonly Permit2ApprovalQuery[],
  ): Promise<ScannerBatchResult<Approval>>;
}

export interface WalletScanner {
  readonly id: string;
  supports(chainId: number): Promise<boolean>;
  scan(request: WalletScanRequest): Promise<DeterministicScanReport>;
}
