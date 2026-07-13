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
    const manifestTokens = metadata.flatMap((entry) =>
      "query" in entry ? [entry.query] : [],
    );
    const omitted = metadata.flatMap((entry) =>
      "reason" in entry ? [`${entry.tokenAddress}: ${entry.reason}.`] : [],
    );
    const scanner = new DeterministicWalletScanner({
      config: xLayerTestnetConfig,
      reader: new ViemStandardReadClient("x-layer-testnet-agent-rpc", client),
    });
    const report = await scanner.scan({
      incidentId: incident.id,
      chainId: incident.chainId,
      address: incident.sourceAddress,
      observedAtBlock,
      manifest: { erc20Assets: manifestTokens },
    });

    return walletScanSchema.parse({
      ...report.scan,
      status: "PARTIAL",
      providerId: "safeexit-live-xlayer-testnet-manifest-v1",
      warnings: [
        ...report.scan.warnings,
        "X Layer testnet agent discovery used only the explicit ERC-20 manifest and pinned RPC state.",
        "Native balance is detected for incident context but has no enabled destination-paid recovery route.",
        ...omitted,
      ],
    });
  }
}
