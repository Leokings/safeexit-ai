import { describe, expect, it } from "vitest";

import { parseDeploymentEnvironment } from "./deployment-env";
import {
  createSafeExitX402PostRouteConfig,
  createSafeExitX402PrepareRouteConfigs,
  getSafeExitX402Configuration,
  SAFEEXIT_X402_NETWORK,
  SAFEEXIT_X402_PRICE,
} from "./okx-x402-config";
import {
  createSafeExitRequestExample,
  createSafeExitX402ChallengeJsonSchema,
} from "./safeexit-service-discovery";

function configuredEnvironment() {
  return parseDeploymentEnvironment({
    NODE_ENV: "production",
    SAFEEXIT_X402_MODE: "MAINNET",
    SAFEEXIT_X402_PAY_TO_ADDRESS: "0x4ab2b4be420a82031dc155c0be856ae383e0ba7e",
    OKX_WEB3_API_KEY: "api-key",
    OKX_WEB3_SECRET_KEY: "secret-key",
    OKX_WEB3_PASSPHRASE: "passphrase",
  });
}

describe("OKX x402 configuration", () => {
  it("pins the paid rescue-preparation POST to X Layer and 0.1 USD₮0", () => {
    const configuration = getSafeExitX402Configuration(configuredEnvironment());
    expect(configuration).toEqual({
      network: SAFEEXIT_X402_NETWORK,
      payTo: "0x4ab2b4be420a82031dc155c0be856ae383e0ba7e",
      price: SAFEEXIT_X402_PRICE,
    });
    const routeConfig = createSafeExitX402PostRouteConfig(configuration, {
      schema: { type: "object" },
      example: { schemaVersion: "safeexit-okx-x402-v1" },
    });
    expect(routeConfig.accepts).toMatchObject({
      scheme: "exact",
      network: "eip155:196",
      price: "$0.10",
    });
    expect(routeConfig.description).toContain(
      "deterministic SAFEEXIT rescue plan",
    );
    expect(routeConfig.description).toContain(
      "do not substitute a standalone x402 payment",
    );
    expect(routeConfig.extensions.bazaar.info.input).toEqual({
      type: "http",
      method: "POST",
      bodyType: "json",
      body: { schemaVersion: "safeexit-okx-x402-v1" },
    });
    expect(routeConfig.extensions.bazaar.schema).toMatchObject({
      properties: {
        input: {
          properties: {
            method: { type: "string", enum: ["POST"] },
            body: { type: "object" },
          },
        },
      },
    });
    expect(routeConfig.unpaidResponseBody().body).toMatchObject({
      code: "PAYMENT_REQUIRED",
      requiredInput: {
        method: "POST",
        contentType: "application/json",
        example: { schemaVersion: "safeexit-okx-x402-v1" },
      },
      marketplaceTaskGuidance: {
        mode: "DESIGNATED_X402",
        attachRequestBodyAtTaskCreation: true,
        useTaskLinkedPaymentReplay: true,
        saveResponseAsTaskDeliverable: true,
        completeOnlyAfterDeliverable: true,
        standalonePaymentDoesNotCompleteTask: true,
      },
    });

    const routes = createSafeExitX402PrepareRouteConfigs(
      "/api/agent/okx/prepare-paid",
      configuration,
      { schema: { $id: "https://safeexit.xyz/api/agent/okx/schema" }, example: {} },
    );
    expect(routes["GET /api/agent/okx/prepare-paid"]?.extensions.bazaar.info.input.method)
      .toBe("POST");
    expect(routes["POST /api/agent/okx/prepare-paid"]).toBe(
      routes["GET /api/agent/okx/prepare-paid"],
    );
  });

  it("keeps the encoded challenge metadata below proxy header limits", () => {
    const configuration = getSafeExitX402Configuration(configuredEnvironment());
    const routeConfig = createSafeExitX402PostRouteConfig(configuration, {
      schema: createSafeExitX402ChallengeJsonSchema(
        "https://safeexit.xyz",
        new Date("2026-07-21T00:00:00.000Z"),
      ),
      example: createSafeExitRequestExample(
        new Date("2026-07-21T00:00:00.000Z"),
      ),
    });
    const extensionBytes = new TextEncoder().encode(
      JSON.stringify(routeConfig.extensions),
    ).byteLength;

    expect(extensionBytes).toBeLessThan(4_000);
  });

  it("refuses to expose a paid endpoint with incomplete credentials", () => {
    const environment = parseDeploymentEnvironment({
      NODE_ENV: "production",
      SAFEEXIT_X402_MODE: "MAINNET",
      SAFEEXIT_X402_PAY_TO_ADDRESS: "0x4ab2b4be420a82031dc155c0be856ae383e0ba7e",
    });
    expect(() => getSafeExitX402Configuration(environment)).toThrow(
      "configuration is incomplete",
    );
  });

  it("rejects malformed payout addresses", () => {
    expect(() =>
      parseDeploymentEnvironment({
        NODE_ENV: "production",
        SAFEEXIT_X402_MODE: "MAINNET",
        SAFEEXIT_X402_PAY_TO_ADDRESS: "0xnot-an-address",
      }),
    ).toThrow();
  });
});
