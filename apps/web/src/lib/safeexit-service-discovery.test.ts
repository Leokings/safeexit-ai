import { okxX402PrepareRequestSchema } from "@safeexit/okx-transport";
import { describe, expect, it } from "vitest";

import {
  applySafeExitServiceDiscoveryHeaders,
  createSafeExitRequestJsonSchema,
  createSafeExitX402ChallengeJsonSchema,
  createSafeExitServiceManifest,
  SAFEEXIT_PAID_PREPARE_PATH,
  SAFEEXIT_REQUEST_SCHEMA_PATH,
  SAFEEXIT_SERVICE_MANIFEST_PATH,
} from "./safeexit-service-discovery";

const origin = "https://safeexit.xyz";
const observedAt = new Date("2026-07-18T09:00:00.000Z");

function record(value: unknown): Record<string, unknown> {
  expect(value).toBeTypeOf("object");
  expect(value).not.toBeNull();
  expect(Array.isArray(value)).toBe(false);
  return value as Record<string, unknown>;
}

describe("Safe Exit service discovery", () => {
  it("publishes hosted provider and buyer-runtime boundaries", () => {
    const manifest = createSafeExitServiceManifest(origin, observedAt);

    expect(manifest.agent).toEqual({ id: "5196", name: "Safe Exit" });
    expect(manifest.service.endpoint).toMatchObject({
      method: "POST",
      url: `https://safeexit.xyz${SAFEEXIT_PAID_PREPARE_PATH}`,
      requestSchemaUrl: `https://safeexit.xyz${SAFEEXIT_REQUEST_SCHEMA_PATH}`,
      paymentRequired: true,
      paymentReplayRequired: true,
      initialPaymentProbe: {
        method: "GET",
      },
    });
    expect(manifest.service.endpoint.networkChoices).toEqual([
      { name: "Ethereum", chainId: 1, aliases: ["Ethereum Mainnet", "ETH"] },
      { name: "BNB Smart Chain", chainId: 56, aliases: ["BNB Chain", "BSC", "BNB"] },
      { name: "Polygon", chainId: 137, aliases: ["Polygon PoS", "MATIC"] },
      { name: "Arbitrum", chainId: 42_161, aliases: ["Arbitrum One", "ARB"] },
      { name: "Optimism", chainId: 10, aliases: ["OP Mainnet", "OP"] },
      { name: "Base", chainId: 8_453, aliases: ["Base Mainnet"] },
      { name: "Avalanche", chainId: 43_114, aliases: ["Avalanche C-Chain", "AVAX"] },
      { name: "X Layer", chainId: 196, aliases: ["X Layer Mainnet", "OKX X Layer"] },
    ]);
    expect(manifest.service.marketplaceTaskWorkflow).toMatchObject({
      mode: "DESIGNATED_X402",
      requestBodyRequiredAtTaskCreation: true,
      paymentMustBeTaskLinked: true,
      responseMustBeSavedAsTaskDeliverable: true,
      completeOnlyAfterDeliverable: true,
      standalonePaymentDoesNotCompleteTask: true,
    });
    expect(manifest.runtimeRequirements).toEqual({
      hostedHttpsService: true,
      providerRuntime: "SAFEEXIT_HOSTED",
      buyerAgentRuntimeRequired: true,
      buyerAgentRuntimeOwnership: "CALLER_MANAGED",
      buyerAgentRuntimeLocations: ["LOCAL_DAEMON", "CALLER_HOSTED"],
      buyerWalletExecutionRequired: true,
      localFilesystemAccessRequired: false,
      conversationHistoryAccessRequired: false,
      localArtifactPersistenceRequired: false,
    });
    expect(manifest.security).toMatchObject({
      custody: "NON_CUSTODIAL",
      signingPackageHandling: "MEMORY_ONLY_BY_DEFAULT",
      sourceSignaturesPersisted: false,
      signedAuthorizationsPersisted: false,
      privateCredentialsAccepted: false,
      arbitraryCalldataAccepted: false,
    });
    expect(manifest.capabilities.supportedChains.map(({ chainId }) => chainId))
      .toEqual([1, 56, 137, 42_161, 10, 8_453, 43_114, 196]);
    expect(
      manifest.buyerAgentInstructions.some((instruction) =>
        instruction.includes("caller-managed buyer-agent runtime"),
      ),
    ).toBe(true);
    expect(
      manifest.buyerAgentInstructions.some((instruction) =>
        instruction.includes("fetch the free manifest and request schema"),
      ),
    ).toBe(true);
    expect(
      manifest.buyerAgentInstructions.some((instruction) =>
        instruction.includes("same JSON POST through the OKX Agent Payments Protocol"),
      ),
    ).toBe(true);
    expect(
      manifest.buyerAgentInstructions.some((instruction) =>
        instruction.includes("marketplace task-linked payment"),
      ),
    ).toBe(true);
    expect(
      manifest.buyerAgentInstructions.some((instruction) =>
        instruction.includes("cannot complete that task or enable feedback"),
      ),
    ).toBe(true);
    expect(
      manifest.buyerAgentInstructions.some((instruction) =>
        instruction.includes("complete JSON Schema"),
      ),
    ).toBe(true);
    expect(
      manifest.buyerAgentInstructions.some((instruction) =>
        instruction.includes("network by name, not numeric chain ID"),
      ),
    ).toBe(true);
    expect(
      manifest.buyerAgentInstructions.some((instruction) =>
        instruction.includes("Do not inspect unrelated local files"),
      ),
    ).toBe(true);
    expect(
      manifest.buyerAgentInstructions.some((instruction) =>
        instruction.includes("Do not create local files or artifacts"),
      ),
    ).toBe(true);
    expect(
      manifest.buyerAgentInstructions.some((instruction) =>
        instruction.includes("Never persist source signatures"),
      ),
    ).toBe(true);
  });

  it("keeps the published example accepted by the production validator", () => {
    const manifest = createSafeExitServiceManifest(origin, observedAt);

    expect(() =>
      okxX402PrepareRequestSchema.parse(manifest.request.example),
    ).not.toThrow();
    expect(manifest.request.example.authorization.confirmedAt).toBe(
      observedAt.toISOString(),
    );
  });

  it("derives a strict JSON Schema from the production request schema", () => {
    const schema = createSafeExitRequestJsonSchema(origin, observedAt);
    const properties = record(schema.properties);
    const walletContext = record(properties.walletContext);
    const walletProperties = record(walletContext.properties);
    const chainId = record(walletProperties.chainId);
    const assetManifest = record(properties.assetManifest);

    expect(schema.$id).toBe(`https://safeexit.xyz${SAFEEXIT_REQUEST_SCHEMA_PATH}`);
    expect(schema.additionalProperties).toBe(false);
    expect(chainId.enum).toEqual([1, 56, 137, 42_161, 10, 8_453, 43_114, 196]);
    expect(chainId["x-safeexit-user-facing-label"]).toBe("Network");
    expect(chainId["x-safeexit-network-choices"]).toContainEqual({
      name: "X Layer",
      chainId: 196,
      aliases: ["X Layer Mainnet", "OKX X Layer"],
    });
    expect(assetManifest.allOf).toBeDefined();
    expect(schema.examples).toEqual([
      createSafeExitServiceManifest(origin, observedAt).request.example,
    ]);
  });

  it("publishes compact x402 metadata while linking the complete schema", () => {
    const schema = createSafeExitX402ChallengeJsonSchema(origin, observedAt);
    const properties = record(schema.properties);
    const walletContext = record(properties.walletContext);
    const walletProperties = record(walletContext.properties);
    const chainId = record(walletProperties.chainId);

    expect(schema.$id).toBe(`https://safeexit.xyz${SAFEEXIT_REQUEST_SCHEMA_PATH}`);
    expect(chainId.enum).toEqual([1, 56, 137, 42_161, 10, 8_453, 43_114, 196]);
    expect(chainId["x-safeexit-network-choices"]).toBeUndefined();
    expect(schema.examples).toBeUndefined();
    expect(new TextEncoder().encode(JSON.stringify(schema)).byteLength)
      .toBeLessThan(3_000);
  });

  it("advertises the free manifest and request schema on paid responses", () => {
    const headers = new Headers({
      Link: "<https://example.com/existing>; rel=alternate",
    });

    applySafeExitServiceDiscoveryHeaders(headers, `${origin}/api/paid`);

    expect(headers.get("Link")).toContain(
      `<${origin}${SAFEEXIT_SERVICE_MANIFEST_PATH}>; rel="service-desc"`,
    );
    expect(headers.get("Link")).toContain(
      `<${origin}${SAFEEXIT_REQUEST_SCHEMA_PATH}>; rel="describedby"`,
    );
    expect(headers.get("X-SafeExit-Service-Manifest")).toBe(
      `${origin}${SAFEEXIT_SERVICE_MANIFEST_PATH}`,
    );
    expect(headers.get("X-SafeExit-Provider-Runtime")).toBe("hosted");
    expect(headers.get("X-SafeExit-Buyer-Runtime")).toBe("required");
    expect(headers.get("X-SafeExit-Local-Runtime")).toBe("buyer-managed");
    expect(headers.get("X-SafeExit-Marketplace-Flow")).toBe(
      "designated-x402-task",
    );
    expect(headers.get("X-SafeExit-Task-Payment")).toBe(
      "task-linked-replay-required",
    );
  });
});
