import { okxX402PrepareRequestSchema } from "@safeexit/okx-transport";
import { describe, expect, it } from "vitest";

import {
  applySafeExitServiceDiscoveryHeaders,
  createSafeExitRequestJsonSchema,
  createSafeExitServiceManifest,
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
  it("publishes hosted runtime and credential boundaries", () => {
    const manifest = createSafeExitServiceManifest(origin, observedAt);

    expect(manifest.agent).toEqual({ id: "5196", name: "Safe Exit" });
    expect(manifest.service.endpoint).toMatchObject({
      method: "POST",
      url: "https://safeexit.xyz/api/agent/okx/prepare-paid",
      requestSchemaUrl: `https://safeexit.xyz${SAFEEXIT_REQUEST_SCHEMA_PATH}`,
    });
    expect(manifest.runtimeRequirements).toEqual({
      hostedHttpsService: true,
      localDaemonRequired: false,
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
        instruction.includes("Do not inspect local files"),
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
    expect(assetManifest.allOf).toBeDefined();
    expect(schema.examples).toEqual([
      createSafeExitServiceManifest(origin, observedAt).request.example,
    ]);
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
    expect(headers.get("X-SafeExit-Local-Runtime")).toBe("not-required");
  });
});
