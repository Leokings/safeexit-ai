import type { IncidentAnalyzerPort } from "@safeexit/agent-service";
import { createDedicatedPublicClient, xLayerTestnetConfig } from "@safeexit/chain";
import type { OkxA2AAssetManifest } from "@safeexit/okx-transport";
import {
  DeterministicWalletScanner,
  ViemStandardReadClient,
} from "@safeexit/scanner";
import {
  walletScanSchema,
  type Incident,
  type WalletScan,
} from "@safeexit/shared";
import type { Address } from "viem";

const erc20MetadataAbi = [
  {
    type: "function",
    name: "name",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
  },
  {
    type: "function",
    name: "symbol",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
  },
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
] as const;

const erc721MetadataAbi = [
  {
    type: "function",
    name: "name",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
  },
] as const;

function safeMetadata(value: string, maximum: number, fallback: string): string {
  const normalized = value.replace(/[\u0000-\u001F\u007F]/g, "").trim().slice(0, maximum);
  return normalized || fallback;
}

export class LiveXLayerTestnetManifestAnalyzer implements IncidentAnalyzerPort {
  constructor(
    private readonly rpcUrl: string,
    private readonly manifest?: OkxA2AAssetManifest,
  ) {}

  async analyse(incident: Incident): Promise<WalletScan> {
    if (incident.chainId !== xLayerTestnetConfig.chain.id) {
      throw new Error("Testnet manifest discovery supports X Layer testnet only");
    }
    if (!this.manifest) {
      throw new Error("X Layer testnet discovery requires an explicit asset manifest");
    }

    const client = createDedicatedPublicClient(xLayerTestnetConfig, this.rpcUrl);
    const observedAtBlock = await client.getBlockNumber();
    const tokenAddresses = [
      ...new Map(
        this.manifest.erc20TokenAddresses.map((address) => [address.toLowerCase(), address]),
      ).values(),
    ];
    const metadata = await Promise.all(
      tokenAddresses.map(async (tokenAddress) => {
        try {
          const [name, symbol, decimals] = await Promise.all([
            client.readContract({
              address: tokenAddress as Address,
              abi: erc20MetadataAbi,
              functionName: "name",
              blockNumber: observedAtBlock,
            }),
            client.readContract({
              address: tokenAddress as Address,
              abi: erc20MetadataAbi,
              functionName: "symbol",
              blockNumber: observedAtBlock,
            }),
            client.readContract({
              address: tokenAddress as Address,
              abi: erc20MetadataAbi,
              functionName: "decimals",
              blockNumber: observedAtBlock,
            }),
          ]);
          return {
            query: {
              tokenAddress,
              name: safeMetadata(name, 128, "Unlabelled ERC-20"),
              symbol: safeMetadata(symbol, 32, "TOKEN"),
              decimals,
            },
          } as const;
        } catch {
          return {
            tokenAddress,
            reason: "Standard ERC-20 metadata reads failed at the pinned block",
          } as const;
        }
      }),
    );
    const erc721Metadata = await Promise.all(
      this.manifest.erc721Assets.map(async (asset) => {
        try {
          const address = asset.collectionAddress as Address;
          const bytecode = await client.getCode({ address, blockNumber: observedAtBlock });
          if (!bytecode) {
            throw new Error("No bytecode");
          }
          const name = await client.readContract({
            address,
            abi: erc721MetadataAbi,
            functionName: "name",
            blockNumber: observedAtBlock,
          }).catch(() => "Unlabelled ERC-721");
          return {
            query: {
              collectionAddress: asset.collectionAddress,
              tokenId: BigInt(asset.tokenId),
              name: safeMetadata(name, 128, "Unlabelled ERC-721"),
            },
          } as const;
        } catch {
          return {
            asset,
            reason: "ERC-721 contract verification failed at the pinned block",
          } as const;
        }
      }),
    );
    const erc1155Metadata = await Promise.all(
      this.manifest.erc1155Assets.map(async (asset) => {
        const address = asset.collectionAddress as Address;
        const bytecode = await client.getCode({ address, blockNumber: observedAtBlock });
        return bytecode
          ? {
              query: {
                collectionAddress: asset.collectionAddress,
                tokenId: BigInt(asset.tokenId),
              },
            } as const
          : {
              asset,
              reason: "ERC-1155 contract verification failed at the pinned block",
            } as const;
      }),
    );
    const manifestTokens = metadata.flatMap((entry) =>
      "query" in entry ? [entry.query] : [],
    );
    const omitted = metadata.flatMap((entry) =>
      "reason" in entry ? [`${entry.tokenAddress}: ${entry.reason}.`] : [],
    );
    const manifestErc721Assets = erc721Metadata.flatMap((entry) =>
      "query" in entry ? [entry.query] : [],
    );
    const manifestErc1155Assets = erc1155Metadata.flatMap((entry) =>
      "query" in entry ? [entry.query] : [],
    );
    const omittedNfts = [
      ...erc721Metadata.flatMap((entry) =>
        "reason" in entry && entry.asset
          ? [`${entry.asset.collectionAddress}:${entry.asset.tokenId}: ${entry.reason}.`]
          : [],
      ),
      ...erc1155Metadata.flatMap((entry) =>
        "reason" in entry && entry.asset
          ? [`${entry.asset.collectionAddress}:${entry.asset.tokenId}: ${entry.reason}.`]
          : [],
      ),
    ];
    const scanner = new DeterministicWalletScanner({
      config: xLayerTestnetConfig,
      reader: new ViemStandardReadClient("x-layer-testnet-agent-rpc", client),
    });
    const report = await scanner.scan({
      incidentId: incident.id,
      chainId: incident.chainId,
      address: incident.sourceAddress,
      observedAtBlock,
      manifest: {
        erc20Assets: manifestTokens,
        erc721Assets: manifestErc721Assets,
        erc1155Assets: manifestErc1155Assets,
      },
    });

    return walletScanSchema.parse({
      ...report.scan,
      status: "PARTIAL",
      providerId: "safeexit-live-xlayer-testnet-manifest-v1",
      warnings: [
        ...report.scan.warnings,
        "X Layer testnet agent discovery used only the explicit ERC-20/ERC-721/ERC-1155 manifest and pinned RPC state.",
        "Native balance is detected for incident context but has no enabled destination-paid recovery route.",
        ...omitted,
        ...omittedNfts,
      ],
    });
  }
}
