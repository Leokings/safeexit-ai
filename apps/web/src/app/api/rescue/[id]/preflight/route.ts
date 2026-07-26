import {
  ERC20_RESCUE_TYPEHASH,
  ERC721_RESCUE_TYPEHASH,
  getConfiguredPermitSettlementAddress,
  getConfiguredPermitSettlementRuntimeHash,
  PERMIT_KIND_DAI,
  PERMIT_KIND_ERC2612,
  PERMIT_SETTLEMENT_NAME,
  PERMIT_SETTLEMENT_VERSION,
  permitSettlementAbi,
} from "@safeexit/adapters";
import { XLAYER_SAFEEXIT_EIP7702_FACTORY_V2 } from "@safeexit/buyer-runtime";
import {
  createDedicatedPublicClient,
  getRescueMainnetChainConfig,
} from "@safeexit/chain";
import { getPrismaClient, PrismaSafeExitRepository } from "@safeexit/persistence";
import { computePlanIntegrityHash, DeterministicRescuePlanner } from "@safeexit/planner";
import { DeterministicWalletScanner, ViemStandardReadClient } from "@safeexit/scanner";
import {
  ApiInputError,
  parseJsonBody,
} from "@safeexit/security";
import {
  rescuePlanSchema,
  walletScanSchema,
  type EvmAddress,
  type RescueAssetManifest,
  type RescuePlan,
} from "@safeexit/shared";
import {
  LocalSimulationProvider,
  simulateRescuePlan,
  ViemLocalSimulationClient,
} from "@safeexit/simulator";
import {
  encodeFunctionData,
  hashDomain,
  keccak256,
  stringToHex,
  type Address,
} from "viem";

import {
  getDeploymentRpcUrl,
  parseDeploymentEnvironment,
} from "@/lib/deployment-env";
import { hasNonEmptyEvmRevertData } from "@/lib/evm-revert-data";
import { rateLimitPublicRequest } from "@/lib/agent-http";
import { EIP7702_SIMULATION_PROVIDER_ID } from "@/lib/eip7702-constants";
import { LiveEip7702SigningPackageBuilder } from "@/lib/live-eip7702-signing-package-builder";
import {
  eip712DomainSchema,
  mainnetPreflightRequestSchema,
  mainnetPreflightResponseSchema,
  type Eip712Domain,
  type Eip7702RescueRoute,
  type GaslessRescueAction,
} from "@/lib/mainnet-rescue";

export const runtime = "nodejs";

async function verifiedPermitSettlement(
  client: ReturnType<typeof createDedicatedPublicClient>,
  chainId: number,
  blockNumber: bigint,
): Promise<EvmAddress | undefined> {
  const configured = getConfiguredPermitSettlementAddress(chainId);
  const expectedRuntimeHash = getConfiguredPermitSettlementRuntimeHash(chainId);
  if (!configured || !expectedRuntimeHash) return undefined;
  const address = configured as Address;
  try {
    const code = await client.getCode({ address, blockNumber });
    if (!code || code === "0x") return undefined;
    if (keccak256(code).toLowerCase() !== expectedRuntimeHash.toLowerCase()) {
      return undefined;
    }
    const [domain, erc2612Kind, daiKind, erc20Typehash, erc721Typehash] =
      await Promise.all([
        client.readContract({
          address,
          abi: permitSettlementAbi,
          functionName: "eip712Domain",
          blockNumber,
        }),
        client.readContract({
          address,
          abi: permitSettlementAbi,
          functionName: "PERMIT_KIND_ERC2612",
          blockNumber,
        }),
        client.readContract({
          address,
          abi: permitSettlementAbi,
          functionName: "PERMIT_KIND_DAI",
          blockNumber,
        }),
        client.readContract({
          address,
          abi: permitSettlementAbi,
          functionName: "ERC20_RESCUE_TYPEHASH",
          blockNumber,
        }),
        client.readContract({
          address,
          abi: permitSettlementAbi,
          functionName: "ERC721_RESCUE_TYPEHASH",
          blockNumber,
        }),
      ]);
    const [fields, name, version, reportedChainId, verifyingContract, salt, extensions] = domain;
    return fields === "0x0f" &&
      name === PERMIT_SETTLEMENT_NAME &&
      version === PERMIT_SETTLEMENT_VERSION &&
      reportedChainId === BigInt(chainId) &&
      verifyingContract.toLowerCase() === address.toLowerCase() &&
      /^0x0{64}$/i.test(salt) &&
      extensions.length === 0 &&
      erc2612Kind === PERMIT_KIND_ERC2612 &&
      daiKind === PERMIT_KIND_DAI &&
      erc20Typehash.toLowerCase() === ERC20_RESCUE_TYPEHASH &&
      erc721Typehash.toLowerCase() === ERC721_RESCUE_TYPEHASH
      ? configured
      : undefined;
  } catch {
    return undefined;
  }
}

const metadataAbi = [
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

const nftMetadataAbi = [
  {
    type: "function",
    name: "name",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
  },
] as const;

const eip3009CapabilityAbi = [
  {
    type: "function",
    name: "eip712Domain",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "fields", type: "bytes1" },
      { name: "name", type: "string" },
      { name: "version", type: "string" },
      { name: "chainId", type: "uint256" },
      { name: "verifyingContract", type: "address" },
      { name: "salt", type: "bytes32" },
      { name: "extensions", type: "uint256[]" },
    ],
  },
  {
    type: "function",
    name: "DOMAIN_SEPARATOR",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "bytes32" }],
  },
  {
    type: "function",
    name: "RECEIVE_WITH_AUTHORIZATION_TYPEHASH",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "bytes32" }],
  },
  {
    type: "function",
    name: "authorizationState",
    stateMutability: "view",
    inputs: [
      { name: "authorizer", type: "address" },
      { name: "nonce", type: "bytes32" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

const erc2612CapabilityAbi = [
  {
    type: "function",
    name: "nonces",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "permit",
    stateMutability: "nonpayable",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
      { name: "value", type: "uint256" },
      { name: "deadline", type: "uint256" },
      { name: "v", type: "uint8" },
      { name: "r", type: "bytes32" },
      { name: "s", type: "bytes32" },
    ],
    outputs: [],
  },
] as const;

const daiPermitCapabilityAbi = [
  {
    type: "function",
    name: "nonces",
    stateMutability: "view",
    inputs: [{ name: "holder", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "DOMAIN_SEPARATOR",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "bytes32" }],
  },
  {
    type: "function",
    name: "PERMIT_TYPEHASH",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "bytes32" }],
  },
  {
    type: "function",
    name: "permit",
    stateMutability: "nonpayable",
    inputs: [
      { name: "holder", type: "address" },
      { name: "spender", type: "address" },
      { name: "nonce", type: "uint256" },
      { name: "expiry", type: "uint256" },
      { name: "allowed", type: "bool" },
      { name: "v", type: "uint8" },
      { name: "r", type: "bytes32" },
      { name: "s", type: "bytes32" },
    ],
    outputs: [],
  },
] as const;

const erc4494CapabilityAbi = [
  {
    type: "function",
    name: "supportsInterface",
    stateMutability: "view",
    inputs: [{ name: "interfaceId", type: "bytes4" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "nonces",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "permit",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "tokenId", type: "uint256" },
      { name: "deadline", type: "uint256" },
      { name: "signature", type: "bytes" },
    ],
    outputs: [],
  },
] as const;

const eip712DomainTypes = {
  EIP712Domain: [
    { name: "name", type: "string" },
    { name: "version", type: "string" },
    { name: "chainId", type: "uint256" },
    { name: "verifyingContract", type: "address" },
  ],
} as const;

const receiveWithAuthorizationTypehash =
  "0xd099cc98ef71107a616c4f0f941f04c322d8e254fe26b3c6668db87aae413de8";
const daiPermitTypehash = keccak256(stringToHex(
  "Permit(address holder,address spender,uint256 nonce,uint256 expiry,bool allowed)",
));
const zeroBytes32 = `0x${"00".repeat(32)}` as const;
const invalidSignature = `0x${"00".repeat(65)}` as const;
const erc4494InterfaceId = "0x5604e225";

function safeMetadata(value: string, maximum: number, fallback: string): string {
  const printable = value.replace(/[^\x20-\x7E]/g, "").trim().slice(0, maximum);
  return printable || fallback;
}

function safeDomainText(value: string, maximum: number): string {
  return value.replace(/[\u0000-\u001F\u007F]/g, "").trim().slice(0, maximum);
}

function manifestKeys(manifest: RescueAssetManifest): string[] {
  return [
    ...manifest.erc20TokenAddresses.map(
      (address) => `erc20:${address.toLowerCase()}`,
    ),
    ...manifest.erc721Assets.map(
      (asset) => `erc721:${asset.collectionAddress.toLowerCase()}:${asset.tokenId}`,
    ),
    ...manifest.erc1155Assets.map(
      (asset) => `erc1155:${asset.collectionAddress.toLowerCase()}:${asset.tokenId}`,
    ),
  ].sort();
}

function sameManifest(
  expected: RescueAssetManifest,
  supplied: RescueAssetManifest,
): boolean {
  return JSON.stringify(manifestKeys(expected)) === JSON.stringify(manifestKeys(supplied));
}

async function readVerifiedEip712Domain(
  client: ReturnType<typeof createDedicatedPublicClient>,
  tokenAddress: Address,
  blockNumber: bigint,
  expectedChainId: number,
): Promise<Eip712Domain | undefined> {
  try {
    const [domainFields, domainSeparator] = await Promise.all([
      client.readContract({
        address: tokenAddress,
        abi: eip3009CapabilityAbi,
        functionName: "eip712Domain",
        blockNumber,
      }),
      client.readContract({
        address: tokenAddress,
        abi: eip3009CapabilityAbi,
        functionName: "DOMAIN_SEPARATOR",
        blockNumber,
      }),
    ]);
    const [fields, rawName, rawVersion, chainId, verifyingContract, , extensions] =
      domainFields;
    const name = safeDomainText(rawName, 128);
    const version = safeDomainText(rawVersion, 32);
    if (
      (Number(BigInt(fields)) & 0x0f) !== 0x0f ||
      !name ||
      !version ||
      chainId !== BigInt(expectedChainId) ||
      verifyingContract.toLowerCase() !== tokenAddress.toLowerCase() ||
      extensions.length > 0
    ) {
      return undefined;
    }
    const computedSeparator = hashDomain({
      domain: { name, version, chainId, verifyingContract },
      types: eip712DomainTypes,
    });
    if (computedSeparator.toLowerCase() !== domainSeparator.toLowerCase()) {
      return undefined;
    }
    return eip712DomainSchema.parse({
      name,
      version,
      chainId: expectedChainId,
      verifyingContract,
    });
  } catch {
    return undefined;
  }
}

async function detectEip3009Domain(
  client: ReturnType<typeof createDedicatedPublicClient>,
  tokenAddress: Address,
  sourceAddress: Address,
  blockNumber: bigint,
  chainId: number,
): Promise<Eip712Domain | undefined> {
  const domain = await readVerifiedEip712Domain(
    client,
    tokenAddress,
    blockNumber,
    chainId,
  );
  if (!domain) {
    return undefined;
  }
  try {
    const typehash = await client.readContract({
      address: tokenAddress,
      abi: eip3009CapabilityAbi,
      functionName: "RECEIVE_WITH_AUTHORIZATION_TYPEHASH",
      blockNumber,
    });
    await client.readContract({
      address: tokenAddress,
      abi: eip3009CapabilityAbi,
      functionName: "authorizationState",
      args: [sourceAddress, zeroBytes32],
      blockNumber,
    });
    return typehash.toLowerCase() === receiveWithAuthorizationTypehash
      ? domain
      : undefined;
  } catch {
    return undefined;
  }
}

async function detectErc2612Permit(
  client: ReturnType<typeof createDedicatedPublicClient>,
  tokenAddress: Address,
  sourceAddress: Address,
  destinationAddress: Address,
  blockNumber: bigint,
  chainId: number,
): Promise<{ domain: Eip712Domain; nonce: string } | undefined> {
  const domain = await readVerifiedEip712Domain(
    client,
    tokenAddress,
    blockNumber,
    chainId,
  );
  if (!domain) {
    return undefined;
  }
  try {
    const nonce = await client.readContract({
      address: tokenAddress,
      abi: erc2612CapabilityAbi,
      functionName: "nonces",
      args: [sourceAddress],
      blockNumber,
    });
    const probeData = encodeFunctionData({
      abi: erc2612CapabilityAbi,
      functionName: "permit",
      args: [
        sourceAddress,
        destinationAddress,
        1n,
        9_999_999_999n,
        27,
        zeroBytes32,
        zeroBytes32,
      ],
    });
    try {
      await client.call({
        account: destinationAddress,
        to: tokenAddress,
        data: probeData,
        blockNumber,
      });
      return undefined;
    } catch (error) {
      if (!hasNonEmptyEvmRevertData(error)) {
        return undefined;
      }
      // A signed exact permit call remains the final capability gate in the browser.
    }
    return { domain, nonce: nonce.toString() };
  } catch {
    return undefined;
  }
}

async function detectDaiStylePermit(
  client: ReturnType<typeof createDedicatedPublicClient>,
  tokenAddress: Address,
  sourceAddress: Address,
  destinationAddress: Address,
  blockNumber: bigint,
  chainId: number,
): Promise<{ domain: Eip712Domain; nonce: string } | undefined> {
  try {
    const [rawName, domainSeparator, typehash, nonce] = await Promise.all([
      client.readContract({
        address: tokenAddress,
        abi: metadataAbi,
        functionName: "name",
        blockNumber,
      }),
      client.readContract({
        address: tokenAddress,
        abi: daiPermitCapabilityAbi,
        functionName: "DOMAIN_SEPARATOR",
        blockNumber,
      }),
      client.readContract({
        address: tokenAddress,
        abi: daiPermitCapabilityAbi,
        functionName: "PERMIT_TYPEHASH",
        blockNumber,
      }),
      client.readContract({
        address: tokenAddress,
        abi: daiPermitCapabilityAbi,
        functionName: "nonces",
        args: [sourceAddress],
        blockNumber,
      }),
    ]);
    const name = safeDomainText(rawName, 128);
    if (!name || typehash.toLowerCase() !== daiPermitTypehash.toLowerCase()) {
      return undefined;
    }
    const domain = eip712DomainSchema.parse({
      name,
      version: "1",
      chainId,
      verifyingContract: tokenAddress,
    });
    const computedSeparator = hashDomain({
      domain: {
        name: domain.name,
        version: domain.version,
        chainId: BigInt(domain.chainId),
        verifyingContract: tokenAddress,
      },
      types: eip712DomainTypes,
    });
    if (computedSeparator.toLowerCase() !== domainSeparator.toLowerCase()) {
      return undefined;
    }
    const probeData = encodeFunctionData({
      abi: daiPermitCapabilityAbi,
      functionName: "permit",
      args: [
        sourceAddress,
        destinationAddress,
        nonce,
        9_999_999_999n,
        true,
        27,
        zeroBytes32,
        zeroBytes32,
      ],
    });
    try {
      await client.call({
        account: destinationAddress,
        to: tokenAddress,
        data: probeData,
        blockNumber,
      });
      return undefined;
    } catch {
      // Exact allow and revoke signatures remain browser-side capability gates.
    }
    return { domain, nonce: nonce.toString() };
  } catch {
    return undefined;
  }
}

async function detectErc4494Permit(
  client: ReturnType<typeof createDedicatedPublicClient>,
  collectionAddress: Address,
  tokenId: bigint,
  destinationAddress: Address,
  blockNumber: bigint,
  chainId: number,
): Promise<{ domain: Eip712Domain; nonce: string } | undefined> {
  const domain = await readVerifiedEip712Domain(
    client,
    collectionAddress,
    blockNumber,
    chainId,
  );
  if (!domain) {
    return undefined;
  }
  try {
    const [supported, nonce] = await Promise.all([
      client.readContract({
        address: collectionAddress,
        abi: erc4494CapabilityAbi,
        functionName: "supportsInterface",
        args: [erc4494InterfaceId],
        blockNumber,
      }),
      client.readContract({
        address: collectionAddress,
        abi: erc4494CapabilityAbi,
        functionName: "nonces",
        args: [tokenId],
        blockNumber,
      }),
    ]);
    if (!supported) {
      return undefined;
    }
    const probeData = encodeFunctionData({
      abi: erc4494CapabilityAbi,
      functionName: "permit",
      args: [destinationAddress, tokenId, 9_999_999_999n, invalidSignature],
    });
    try {
      await client.call({
        account: destinationAddress,
        to: collectionAddress,
        data: probeData,
        blockNumber,
      });
      return undefined;
    } catch {
      // The exact signed permit call is still required before browser settlement.
    }
    return { domain, nonce: nonce.toString() };
  } catch {
    return undefined;
  }
}

function json(body: unknown, status: number, headers: Record<string, string> = {}): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store", ...headers },
  });
}

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  let rateHeaders: Record<string, string> = {};
  try {
    const rateLimit = await rateLimitPublicRequest(request, "preflight", 10);
    rateHeaders = rateLimit.headers;
    if (!rateLimit.allowed) {
      return json(
        { code: "RATE_LIMITED", message: "Too many preflight requests" },
        429,
        rateHeaders,
      );
    }
  } catch {
    return json(
      {
        code: "RATE_LIMIT_UNAVAILABLE",
        message: "Preflight request protection is temporarily unavailable",
      },
      503,
    );
  }

  try {
    const [{ id }, input] = await Promise.all([
      context.params,
      parseJsonBody(request, mainnetPreflightRequestSchema, { maxBytes: 2_048 }),
    ]);
    const repository = new PrismaSafeExitRepository(getPrismaClient());
    const incident = await repository.getIncident(id);
    if (!incident) {
      return json({ code: "INCIDENT_NOT_FOUND", message: "Incident was not found" }, 404, rateHeaders);
    }
    let chainConfig;
    try {
      chainConfig = getRescueMainnetChainConfig(incident.chainId);
    } catch {
      return json(
        {
          code: "UNSUPPORTED_CHAIN",
          message: "This incident does not use a verified rescue mainnet adapter",
        },
        409,
        rateHeaders,
      );
    }
    const suppliedManifest: RescueAssetManifest = {
      erc20TokenAddresses: input.tokenAddresses,
      erc721Assets: input.erc721Assets,
      erc1155Assets: input.erc1155Assets,
    };
    if (
      incident.assetManifest &&
      !sameManifest(incident.assetManifest, suppliedManifest)
    ) {
      return json(
        {
          code: "ASSET_SCOPE_MISMATCH",
          message: "Preflight assets must exactly match the incident asset manifest",
        },
        409,
        rateHeaders,
      );
    }

    const config = parseDeploymentEnvironment();
    const rpcUrl =
      getDeploymentRpcUrl(config, incident.chainId) ??
      (config.nodeEnv === "production" ? undefined : chainConfig.rpcUrls[0]);
    if (!rpcUrl) {
      return json(
        {
          code: "MAINNET_RPC_UNAVAILABLE",
          message: `${chainConfig.chain.name} mainnet RPC is not configured`,
        },
        503,
        rateHeaders,
      );
    }
    const client = createDedicatedPublicClient(
      chainConfig,
      rpcUrl,
    );
    const observedAtBlock = await client.getBlockNumber();
    const permitSettlement = await verifiedPermitSettlement(
      client,
      incident.chainId,
      observedAtBlock,
    );
    const permitSpender = (
      permitSettlement ?? incident.destinationAddress
    ) as Address;
    const uniqueTokens = [
      ...new Map(input.tokenAddresses.map((address) => [address.toLowerCase(), address])).values(),
    ];
    const uniqueNfts = [
      ...new Map(
        (input.erc721Assets ?? []).map((asset) => [
          `${asset.collectionAddress.toLowerCase()}:${asset.tokenId}`,
          asset,
        ]),
      ).values(),
    ];
    const uniqueErc1155Assets = [
      ...new Map(
        input.erc1155Assets.map((asset) => [
          `${asset.collectionAddress.toLowerCase()}:${asset.tokenId}`,
          asset,
        ]),
      ).values(),
    ];
    const metadata = await Promise.all(
      uniqueTokens.map(async (tokenAddress) => {
        try {
          const address = tokenAddress as Address;
          const bytecode = await client.getCode({ address, blockNumber: observedAtBlock });
          if (!bytecode) {
            return { tokenAddress, reason: "No contract bytecode was found" } as const;
          }
          const [
            name,
            symbol,
            decimals,
            eip3009Domain,
            erc2612Permit,
            daiPermit,
          ] = await Promise.all([
            client.readContract({ address, abi: metadataAbi, functionName: "name", blockNumber: observedAtBlock }),
            client.readContract({ address, abi: metadataAbi, functionName: "symbol", blockNumber: observedAtBlock }),
            client.readContract({ address, abi: metadataAbi, functionName: "decimals", blockNumber: observedAtBlock }),
            detectEip3009Domain(
              client,
              address,
              incident.sourceAddress as Address,
              observedAtBlock,
              incident.chainId,
            ),
            detectErc2612Permit(
              client,
              address,
              incident.sourceAddress as Address,
              permitSpender,
              observedAtBlock,
              incident.chainId,
            ),
            detectDaiStylePermit(
              client,
              address,
              incident.sourceAddress as Address,
              permitSpender,
              observedAtBlock,
              incident.chainId,
            ),
          ]);
          return {
            query: {
              tokenAddress,
              name: safeMetadata(name, 128, "Unlabelled ERC-20"),
              symbol: safeMetadata(symbol, 32, "TOKEN"),
              decimals,
            },
            ...(eip3009Domain ? { eip3009Domain } : {}),
            ...(erc2612Permit ? { erc2612Permit } : {}),
            ...(daiPermit ? { daiPermit } : {}),
          } as const;
        } catch {
          return { tokenAddress, reason: "Standard ERC-20 metadata reads failed" } as const;
        }
      }),
    );
    const nftMetadata = await Promise.all(
      uniqueNfts.map(async (asset) => {
        const address = asset.collectionAddress as Address;
        const tokenId = BigInt(asset.tokenId);
        try {
          const bytecode = await client.getCode({ address, blockNumber: observedAtBlock });
          if (!bytecode) {
            return { ...asset, reason: "No collection contract bytecode was found" } as const;
          }
          const [name, erc4494Permit] = await Promise.all([
            client.readContract({
              address,
              abi: nftMetadataAbi,
              functionName: "name",
              blockNumber: observedAtBlock,
            }).catch(() => "Unlabelled ERC-721"),
            detectErc4494Permit(
              client,
              address,
              tokenId,
              incident.destinationAddress as Address,
              observedAtBlock,
              incident.chainId,
            ),
          ]);
          return {
            query: {
              collectionAddress: asset.collectionAddress,
              tokenId,
              name: safeMetadata(name, 128, "Unlabelled ERC-721"),
            },
            ...(erc4494Permit ? { erc4494Permit } : {}),
          } as const;
        } catch {
          return { ...asset, reason: "Standard ERC-721 capability reads failed" } as const;
        }
      }),
    );
    const erc1155Metadata = await Promise.all(
      uniqueErc1155Assets.map(async (asset) => {
        const address = asset.collectionAddress as Address;
        const bytecode = await client.getCode({ address, blockNumber: observedAtBlock });
        return bytecode
          ? {
              query: {
                collectionAddress: asset.collectionAddress,
                tokenId: BigInt(asset.tokenId),
              },
            } as const
          : { ...asset, reason: "No collection contract bytecode was found" } as const;
      }),
    );
    const manifestTokens = metadata.flatMap((entry) => ("query" in entry ? [entry.query] : []));
    const omittedMetadata = metadata.flatMap((entry) =>
      "reason" in entry ? [`${entry.tokenAddress}: ${entry.reason}.`] : [],
    );
    const manifestNfts = nftMetadata.flatMap((entry) =>
      "query" in entry ? [entry.query] : [],
    );
    const omittedNftMetadata = nftMetadata.flatMap((entry) =>
      "reason" in entry
        ? [`${entry.collectionAddress}:${entry.tokenId}: ${entry.reason}.`]
        : [],
    );
    const manifestErc1155Assets = erc1155Metadata.flatMap((entry) =>
      "query" in entry ? [entry.query] : [],
    );
    const omittedErc1155Metadata = erc1155Metadata.flatMap((entry) =>
      "reason" in entry
        ? [`${entry.collectionAddress}:${entry.tokenId}: ${entry.reason}.`]
        : [],
    );
    const reader = new ViemStandardReadClient(`${chainConfig.id}-rpc`, client);
    const scanner = new DeterministicWalletScanner({
      config: chainConfig,
      reader,
    });
    const report = await scanner.scan({
      incidentId: incident.id,
      chainId: incident.chainId,
      address: incident.sourceAddress,
      observedAtBlock,
      manifest: {
        erc20Assets: manifestTokens,
        erc721Assets: manifestNfts,
        erc1155Assets: manifestErc1155Assets,
      },
    });
    const scan = walletScanSchema.parse({
      ...report.scan,
      status: "PARTIAL",
      warnings: [
        ...report.scan.warnings,
        `${chainConfig.chain.name} mainnet recovery: discovery is limited to native balance and the submitted ERC-20/ERC-721/ERC-1155 manifest.`,
        ...omittedMetadata,
        ...omittedNftMetadata,
        ...omittedErc1155Metadata,
      ],
    });
    await repository.saveWalletScan(scan);

    const generatedPlan = new DeterministicRescuePlanner().plan({
      incidentId: incident.id,
      destinationAddress: incident.destinationAddress,
      policyVersion: `safeexit-${chainConfig.id}-v1`,
      scan,
      adapterCandidates: [],
    });
    const planId = `plan:${incident.id}:mainnet:latest`;
    const planPayload: Omit<RescuePlan, "integrityHash"> = {
      id: planId,
      incidentId: generatedPlan.incidentId,
      version: await repository.resolveRescuePlanVersion(incident.id, planId),
      policyVersion: generatedPlan.policyVersion,
      chainId: generatedPlan.chainId,
      sourceAddress: generatedPlan.sourceAddress,
      destinationAddress: generatedPlan.destinationAddress,
      observedAtBlock: generatedPlan.observedAtBlock,
      status: generatedPlan.status,
      actions: generatedPlan.actions,
      omissions: generatedPlan.omissions,
      createdAt: generatedPlan.createdAt,
    };
    const plan = rescuePlanSchema.parse({
      ...planPayload,
      integrityHash: computePlanIntegrityHash(planPayload),
    });
    await repository.saveRescuePlan(plan);
    const provider = new LocalSimulationProvider({
      id:
        incident.chainId === XLAYER_SAFEEXIT_EIP7702_FACTORY_V2.chainId
          ? EIP7702_SIMULATION_PROVIDER_ID
          : `${chainConfig.id}-rpc-preflight-v1`,
      kind: "PRODUCTION_RPC",
      client: new ViemLocalSimulationClient(`${chainConfig.id}-preflight-client`, client),
      ttlMs: 300_000,
      estimateGas: false,
    });
    const simulation = await simulateRescuePlan(plan, provider);
    await Promise.all(simulation.results.map((result) => repository.saveSimulation(result)));
    const metadataByToken = new Map(
      metadata.flatMap((entry) =>
        "query" in entry
          ? [[entry.query.tokenAddress.toLowerCase(), entry] as const]
          : [],
      ),
    );
    const metadataByNft = new Map(
      nftMetadata.flatMap((entry) =>
        "query" in entry
          ? [[`${entry.query.collectionAddress.toLowerCase()}:${entry.query.tokenId.toString()}`, entry] as const]
          : [],
      ),
    );
    const successfulActionIds = new Set(
      simulation.results
        .filter((result) => result.status === "SUCCEEDED")
        .map((result) => result.actionId),
    );
    const gaslessActions = plan.actions.flatMap<GaslessRescueAction>((action) => {
      if (!successfulActionIds.has(action.id)) {
        return [];
      }
      if (action.actionType === "TRANSFER_ERC721") {
        const collectionMetadata = metadataByNft.get(
          `${action.parameters.collectionAddress.toLowerCase()}:${action.parameters.tokenId}`,
        );
        if (
          !collectionMetadata ||
          !("erc4494Permit" in collectionMetadata) ||
          !collectionMetadata.erc4494Permit ||
          !permitSettlement
        ) {
          return [];
        }
        return [{
          actionId: action.id,
          executionPath: "SAFEEXIT_SETTLEMENT" as const,
          authorizationStandard: "ERC4494" as const,
          standard: "ERC4494_PERMIT_SETTLEMENT" as const,
          capabilityStatus: "SIGNATURE_VERIFICATION_REQUIRED" as const,
          collectionAddress: action.parameters.collectionAddress,
          from: action.sourceAddress,
          to: action.parameters.recipient,
          tokenId: action.parameters.tokenId,
          nonce: collectionMetadata.erc4494Permit.nonce,
          domain: collectionMetadata.erc4494Permit.domain,
          settlementContract: permitSettlement,
          requiredSignatures: 2 as const,
        }];
      }
      if (action.actionType !== "TRANSFER_ERC20") {
        return [];
      }
      const tokenMetadata = metadataByToken.get(action.parameters.tokenAddress.toLowerCase());
      if (!tokenMetadata) {
        return [];
      }
      const routes = [];
      if ("eip3009Domain" in tokenMetadata && tokenMetadata.eip3009Domain) {
        routes.push({
          actionId: action.id,
          executionPath: "DIRECT_AUTHORIZATION" as const,
          authorizationStandard: "ERC3009" as const,
          standard: "ERC3009_RECEIVE_WITH_AUTHORIZATION" as const,
          capabilityStatus: "VERIFIED" as const,
          tokenAddress: action.parameters.tokenAddress,
          from: action.sourceAddress,
          to: action.parameters.recipient,
          amount: action.parameters.amount,
          domain: tokenMetadata.eip3009Domain,
        });
      }
      if (
        permitSettlement &&
        "erc2612Permit" in tokenMetadata &&
        tokenMetadata.erc2612Permit
      ) {
        routes.push({
          actionId: action.id,
          executionPath: "SAFEEXIT_SETTLEMENT" as const,
          authorizationStandard: "ERC2612" as const,
          standard: "ERC2612_PERMIT_SETTLEMENT" as const,
          capabilityStatus: "SIGNATURE_VERIFICATION_REQUIRED" as const,
          tokenAddress: action.parameters.tokenAddress,
          from: action.sourceAddress,
          to: action.parameters.recipient,
          amount: action.parameters.amount,
          nonce: tokenMetadata.erc2612Permit.nonce,
          domain: tokenMetadata.erc2612Permit.domain,
          settlementContract: permitSettlement,
          requiredSignatures: 2 as const,
        });
      }
      if (
        permitSettlement &&
        "daiPermit" in tokenMetadata &&
        tokenMetadata.daiPermit
      ) {
        routes.push({
          actionId: action.id,
          executionPath: "SAFEEXIT_SETTLEMENT" as const,
          authorizationStandard: "DAI_PERMIT" as const,
          standard: "DAI_PERMIT_SETTLEMENT" as const,
          capabilityStatus: "SIGNATURE_VERIFICATION_REQUIRED" as const,
          tokenAddress: action.parameters.tokenAddress,
          from: action.sourceAddress,
          to: action.parameters.recipient,
          amount: action.parameters.amount,
          nonce: tokenMetadata.daiPermit.nonce,
          domain: tokenMetadata.daiPermit.domain,
          settlementContract: permitSettlement,
          requiredSignatures: 3 as const,
        });
      }
      return routes;
    });
    let eip7702Route: Eip7702RescueRoute | undefined;
    let eip7702UnavailableReason: string | undefined;
    if (incident.chainId === XLAYER_SAFEEXIT_EIP7702_FACTORY_V2.chainId) {
      try {
        const signingPackage = await new LiveEip7702SigningPackageBuilder(
          chainConfig,
          rpcUrl,
          XLAYER_SAFEEXIT_EIP7702_FACTORY_V2,
        ).buildFromPlan({
          jobId: `web:${incident.id}`,
          incidentId: incident.id,
          plan,
          simulation: {
            status: simulation.status,
            providerId: simulation.providerId,
            results: [...simulation.results],
            executableActionIds: simulation.executableActions.map((action) => action.id),
            excludedActionIds: simulation.excludedActions.map((action) => action.actionId),
          },
        });
        eip7702Route = {
          executionPath: "SAFEEXIT_EIP7702" as const,
          authorizationStandard: "EIP7702" as const,
          capabilityStatus: "VERIFIED" as const,
          signingPackage,
        };
      } catch {
        eip7702UnavailableReason =
          "A verified EIP-7702 package is unavailable for the current source state and rescue plan.";
      }
    }
    const recoverableActionIds = new Set([
      ...gaslessActions.map((action) => action.actionId),
      ...(eip7702Route?.signingPackage.actionIds ?? []),
    ]);
    const simulationsByActionId = new Map(
      simulation.results.map((result) => [result.actionId, result]),
    );
    const blockedActions = plan.actions.flatMap((action) => {
      if (recoverableActionIds.has(action.id)) {
        return [];
      }
      const failedSimulation = simulationsByActionId.get(action.id);
      const tokenMetadata =
        action.actionType === "TRANSFER_ERC20"
          ? metadataByToken.get(action.parameters.tokenAddress.toLowerCase())
          : undefined;
      const nftMetadataEntry =
        action.actionType === "TRANSFER_ERC721"
          ? metadataByNft.get(
              `${action.parameters.collectionAddress.toLowerCase()}:${action.parameters.tokenId}`,
            )
          : undefined;
      const verifiedDestinationPaidRoute =
        tokenMetadata &&
        (("eip3009Domain" in tokenMetadata && Boolean(tokenMetadata.eip3009Domain)) ||
          ("erc2612Permit" in tokenMetadata && Boolean(tokenMetadata.erc2612Permit)) ||
          ("daiPermit" in tokenMetadata && Boolean(tokenMetadata.daiPermit)));
      const hasAtomicPermitCapability =
        tokenMetadata &&
        (("erc2612Permit" in tokenMetadata && Boolean(tokenMetadata.erc2612Permit)) ||
          ("daiPermit" in tokenMetadata && Boolean(tokenMetadata.daiPermit)));
      return [{
        actionId: action.id,
        reason:
          failedSimulation?.status !== "SUCCEEDED"
            ? `Current-state simulation did not succeed (${failedSimulation?.status ?? "UNKNOWN"}): ${
                failedSimulation?.failureReason ?? "No deterministic provider reason was returned"
              }.`.slice(0, 500)
          : incident.chainId === XLAYER_SAFEEXIT_EIP7702_FACTORY_V2.chainId &&
              eip7702UnavailableReason
            ? eip7702UnavailableReason
          : action.actionType === "TRANSFER_NATIVE"
            ? "Native rescue requires a verified sponsored EIP-7702 or private atomic bundle path."
            : action.actionType === "TRANSFER_ERC721" && nftMetadataEntry &&
                "erc4494Permit" in nftMetadataEntry && nftMetadataEntry.erc4494Permit
              ? permitSettlement
                ? "The NFT supports ERC-4494, but its current-state transfer preflight did not succeed."
                : "The NFT supports ERC-4494, but this chain has no verified SafeExit permit settlement contract."
              : action.actionType === "TRANSFER_ERC721"
                ? "The NFT does not expose a verified ERC-4494 destination-paid permit route."
            : action.actionType === "TRANSFER_ERC20" && hasAtomicPermitCapability &&
                !permitSettlement
              ? "The token supports a permit route, but this chain has no verified SafeExit permit settlement contract."
            : action.actionType === "TRANSFER_ERC20" && verifiedDestinationPaidRoute
              ? "The token supports a destination-paid authorization, but its current-state transfer preflight did not succeed."
              : action.actionType === "TRANSFER_ERC20"
                ? "The token does not expose a verified ERC-3009, ERC-2612, or DAI-style destination-paid route."
                : "This asset type has no verified destination-paid gasless adapter.",
      }];
    });

    return json(
      mainnetPreflightResponseSchema.parse({
        chainId: incident.chainId,
        scan,
        plan,
        simulations: simulation.results,
        sourceFundedExecutionDisabled: true,
        gaslessActions,
        ...(eip7702Route ? { eip7702Route } : {}),
        ...(eip7702UnavailableReason ? { eip7702UnavailableReason } : {}),
        blockedActions,
      }),
      200,
      rateHeaders,
    );
  } catch (error) {
    if (error instanceof ApiInputError) {
      return json(
        { code: error.code, message: error.message, ...(error.issues ? { issues: error.issues } : {}) },
        error.status,
        rateHeaders,
      );
    }
    console.error("SAFEEXIT_MAINNET_PREFLIGHT_FAILED", {
      name: error instanceof Error ? error.name : "UnknownError",
    });
    return json(
      { code: "PREFLIGHT_UNAVAILABLE", message: "Mainnet preflight is temporarily unavailable" },
      503,
      rateHeaders,
    );
  }
}
