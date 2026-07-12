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
import type { Address } from "viem";

import { parseDeploymentEnvironment } from "@/lib/deployment-env";
import {
  testnetPreflightRequestSchema,
  testnetPreflightResponseSchema,
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
          const [name, symbol, decimals] = await Promise.all([
            client.readContract({ address, abi: metadataAbi, functionName: "name", blockNumber: observedAtBlock }),
            client.readContract({ address, abi: metadataAbi, functionName: "symbol", blockNumber: observedAtBlock }),
            client.readContract({ address, abi: metadataAbi, functionName: "decimals", blockNumber: observedAtBlock }),
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

    return json(
      testnetPreflightResponseSchema.parse({
        chainId: XLAYER_TESTNET_CHAIN_ID,
        scan,
        plan,
        simulations: simulation.results,
        executableActionIds: simulation.executableActions.map((action) => action.id),
        excludedActionIds: simulation.excludedActions.map((action) => action.actionId),
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
