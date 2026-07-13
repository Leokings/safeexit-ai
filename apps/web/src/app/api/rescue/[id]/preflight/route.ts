import { createHash } from "node:crypto";

import { createDedicatedPublicClient, xLayerTestnetConfig } from "@safeexit/chain";
import { getPrismaClient, PrismaSafeExitRepository } from "@safeexit/persistence";
import { computePlanIntegrityHash, DeterministicRescuePlanner } from "@safeexit/planner";
import { DeterministicWalletScanner, ViemStandardReadClient } from "@safeexit/scanner";
import {
  ApiInputError,
  InMemoryRateLimiter,
  parseApiSecurityEnvironment,
  parseJsonBody,
} from "@safeexit/security";
import { rescuePlanSchema, walletScanSchema, type RescuePlan } from "@safeexit/shared";
import {
  LocalSimulationProvider,
  simulateRescuePlan,
  ViemLocalSimulationClient,
} from "@safeexit/simulator";
import { hashDomain, type Address } from "viem";

import { parseDeploymentEnvironment } from "@/lib/deployment-env";
import {
  eip3009DomainSchema,
  testnetPreflightRequestSchema,
  testnetPreflightResponseSchema,
  type Eip3009Domain,
  XLAYER_TESTNET_CHAIN_ID,
} from "@/lib/testnet-rescue";

export const runtime = "nodejs";

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
const zeroBytes32 = `0x${"00".repeat(32)}` as const;

const securityConfig = parseApiSecurityEnvironment(process.env);
const rateLimiter = new InMemoryRateLimiter(
  Math.min(securityConfig.maxRequests, 10),
  securityConfig.windowMs,
);

function clientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const address = forwarded || request.headers.get("x-real-ip") || "unknown";
  return createHash("sha256").update(address.slice(0, 256)).digest("hex");
}

function safeMetadata(value: string, maximum: number, fallback: string): string {
  const printable = value.replace(/[^\x20-\x7E]/g, "").trim().slice(0, maximum);
  return printable || fallback;
}

function safeDomainText(value: string, maximum: number): string {
  return value.replace(/[\u0000-\u001F\u007F]/g, "").trim().slice(0, maximum);
}

async function detectEip3009Domain(
  client: ReturnType<typeof createDedicatedPublicClient>,
  tokenAddress: Address,
  sourceAddress: Address,
  blockNumber: bigint,
): Promise<Eip3009Domain | undefined> {
  try {
    const [domainFields, domainSeparator, typehash] = await Promise.all([
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
      client.readContract({
        address: tokenAddress,
        abi: eip3009CapabilityAbi,
        functionName: "RECEIVE_WITH_AUTHORIZATION_TYPEHASH",
        blockNumber,
      }),
      client.readContract({
        address: tokenAddress,
        abi: eip3009CapabilityAbi,
        functionName: "authorizationState",
        args: [sourceAddress, zeroBytes32],
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
      chainId !== BigInt(XLAYER_TESTNET_CHAIN_ID) ||
      verifyingContract.toLowerCase() !== tokenAddress.toLowerCase() ||
      extensions.length > 0 ||
      typehash.toLowerCase() !== receiveWithAuthorizationTypehash
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
    return eip3009DomainSchema.parse({
      name,
      version,
      chainId: XLAYER_TESTNET_CHAIN_ID,
      verifyingContract,
    });
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
  const decision = rateLimiter.consume(clientKey(request));
  const rateHeaders = {
    "RateLimit-Limit": String(decision.limit),
    "RateLimit-Remaining": String(decision.remaining),
    "RateLimit-Reset": String(Math.ceil(decision.resetAt / 1_000)),
  };
  if (!decision.allowed) {
    return json({ code: "RATE_LIMITED", message: "Too many preflight requests" }, 429, rateHeaders);
  }

  try {
    const [{ id }, input] = await Promise.all([
      context.params,
      parseJsonBody(request, testnetPreflightRequestSchema, { maxBytes: 2_048 }),
    ]);
    const repository = new PrismaSafeExitRepository(getPrismaClient());
    const incident = await repository.getIncident(id);
    if (!incident) {
      return json({ code: "INCIDENT_NOT_FOUND", message: "Incident was not found" }, 404, rateHeaders);
    }
    if (incident.chainId !== XLAYER_TESTNET_CHAIN_ID) {
      return json(
        { code: "TESTNET_ONLY", message: "Browser signing is restricted to X Layer testnet" },
        409,
        rateHeaders,
      );
    }

    const config = parseDeploymentEnvironment();
    const rpcUrl =
      config.xLayerTestnetRpcUrl ??
      (config.nodeEnv === "production" ? undefined : xLayerTestnetConfig.rpcUrls[0]);
    if (!rpcUrl) {
      return json(
        { code: "TESTNET_RPC_UNAVAILABLE", message: "X Layer testnet RPC is not configured" },
        503,
        rateHeaders,
      );
    }
    const client = createDedicatedPublicClient(
      xLayerTestnetConfig,
      rpcUrl,
    );
    const observedAtBlock = await client.getBlockNumber();
    const uniqueTokens = [
      ...new Map(input.tokenAddresses.map((address) => [address.toLowerCase(), address])).values(),
    ];
    const metadata = await Promise.all(
      uniqueTokens.map(async (tokenAddress) => {
        try {
          const address = tokenAddress as Address;
          const bytecode = await client.getCode({ address, blockNumber: observedAtBlock });
          if (!bytecode) {
            return { tokenAddress, reason: "No contract bytecode was found" } as const;
          }
          const [name, symbol, decimals, eip3009Domain] = await Promise.all([
            client.readContract({ address, abi: metadataAbi, functionName: "name", blockNumber: observedAtBlock }),
            client.readContract({ address, abi: metadataAbi, functionName: "symbol", blockNumber: observedAtBlock }),
            client.readContract({ address, abi: metadataAbi, functionName: "decimals", blockNumber: observedAtBlock }),
            detectEip3009Domain(
              client,
              address,
              incident.sourceAddress as Address,
              observedAtBlock,
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
          } as const;
        } catch {
          return { tokenAddress, reason: "Standard ERC-20 metadata reads failed" } as const;
        }
      }),
    );
    const manifestTokens = metadata.flatMap((entry) => ("query" in entry ? [entry.query] : []));
    const omittedMetadata = metadata.flatMap((entry) =>
      "reason" in entry ? [`${entry.tokenAddress}: ${entry.reason}.`] : [],
    );
    const reader = new ViemStandardReadClient("x-layer-testnet-rpc", client);
    const scanner = new DeterministicWalletScanner({
      config: xLayerTestnetConfig,
      reader,
    });
    const report = await scanner.scan({
      incidentId: incident.id,
      chainId: incident.chainId,
      address: incident.sourceAddress,
      observedAtBlock,
      manifest: { erc20Assets: manifestTokens },
    });
    const scan = walletScanSchema.parse({
      ...report.scan,
      status: "PARTIAL",
      warnings: [
        ...report.scan.warnings,
        "X Layer testnet signing pilot: discovery is limited to native balance and the submitted ERC-20 manifest.",
        ...omittedMetadata,
      ],
    });
    await repository.saveWalletScan(scan);

    const generatedPlan = new DeterministicRescuePlanner().plan({
      incidentId: incident.id,
      destinationAddress: incident.destinationAddress,
      policyVersion: "safeexit-xlayer-testnet-v1",
      scan,
      adapterCandidates: [],
    });
    const planPayload: Omit<RescuePlan, "integrityHash"> = {
      id: `plan:${incident.id}:testnet:latest`,
      incidentId: generatedPlan.incidentId,
      version: generatedPlan.version,
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
      id: "x-layer-testnet-rpc-preflight-v1",
      kind: "TEST_RPC",
      client: new ViemLocalSimulationClient("x-layer-testnet-preflight-client", client),
      ttlMs: 60_000,
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
    const successfulActionIds = new Set(
      simulation.results
        .filter((result) => result.status === "SUCCEEDED")
        .map((result) => result.actionId),
    );
    const gaslessActions = plan.actions.flatMap((action) => {
      if (action.actionType !== "TRANSFER_ERC20" || !successfulActionIds.has(action.id)) {
        return [];
      }
      const tokenMetadata = metadataByToken.get(action.parameters.tokenAddress.toLowerCase());
      if (!tokenMetadata || !("eip3009Domain" in tokenMetadata) || !tokenMetadata.eip3009Domain) {
        return [];
      }
      return [{
        actionId: action.id,
        standard: "ERC3009_RECEIVE_WITH_AUTHORIZATION" as const,
        tokenAddress: action.parameters.tokenAddress,
        from: action.sourceAddress,
        to: action.parameters.recipient,
        amount: action.parameters.amount,
        domain: tokenMetadata.eip3009Domain,
      }];
    });
    const gaslessActionIds = new Set(gaslessActions.map((action) => action.actionId));
    const blockedActions = plan.actions.flatMap((action) => {
      if (gaslessActionIds.has(action.id)) {
        return [];
      }
      const tokenMetadata =
        action.actionType === "TRANSFER_ERC20"
          ? metadataByToken.get(action.parameters.tokenAddress.toLowerCase())
          : undefined;
      const verifiedEip3009 =
        tokenMetadata &&
        "eip3009Domain" in tokenMetadata &&
        Boolean(tokenMetadata.eip3009Domain);
      return [{
        actionId: action.id,
        reason:
          action.actionType === "TRANSFER_NATIVE"
            ? "Native rescue requires a verified sponsored EIP-7702 or private atomic bundle path."
            : action.actionType === "TRANSFER_ERC20" && verifiedEip3009
              ? "The token supports ERC-3009, but its current-state transfer preflight did not succeed."
              : action.actionType === "TRANSFER_ERC20"
                ? "The token does not expose a verified ERC-3009 receiveWithAuthorization domain."
                : "This asset type has no verified destination-paid gasless adapter.",
      }];
    });

    return json(
      testnetPreflightResponseSchema.parse({
        chainId: XLAYER_TESTNET_CHAIN_ID,
        scan,
        plan,
        simulations: simulation.results,
        sourceFundedExecutionDisabled: true,
        gaslessActions,
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
    console.error("SAFEEXIT_TESTNET_PREFLIGHT_FAILED", {
      name: error instanceof Error ? error.name : "UnknownError",
    });
    return json(
      { code: "PREFLIGHT_UNAVAILABLE", message: "Testnet preflight is temporarily unavailable" },
      503,
      rateHeaders,
    );
  }
}
