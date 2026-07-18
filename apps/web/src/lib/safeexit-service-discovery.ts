import {
  RESCUE_MAINNET_CHAIN_IDS,
  rescueMainnetChainConfigs,
} from "@safeexit/chain";
import {
  okxX402PrepareRequestSchema,
  SAFEEXIT_AUTHORIZATION_STATEMENT,
} from "@safeexit/okx-transport";
import { z } from "zod";

import {
  SAFEEXIT_X402_NETWORK,
  SAFEEXIT_X402_PRICE,
} from "./okx-x402-config";

export const SAFEEXIT_AGENT_ID = "5196";
export const SAFEEXIT_SERVICE_MANIFEST_VERSION =
  "safeexit-service-manifest-v1";
export const SAFEEXIT_PAID_PREPARE_PATH =
  "/api/agent/okx/prepare-paid";
export const SAFEEXIT_SERVICE_MANIFEST_PATH =
  "/api/agent/okx/manifest";
export const SAFEEXIT_REQUEST_SCHEMA_PATH =
  "/api/agent/okx/schema";

type JsonObject = Record<string, unknown>;

function asJsonObject(value: unknown): JsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Expected a JSON object while publishing the request schema");
  }
  return value as JsonObject;
}

function absoluteUrl(baseUrl: string | URL, path: string): string {
  return new URL(path, baseUrl).toString();
}

export function createSafeExitRequestExample(
  now: Date = new Date(),
): z.input<typeof okxX402PrepareRequestSchema> {
  return {
    schemaVersion: "safeexit-okx-x402-v1",
    transportMode: "OKX_X402",
    requestId: `safeexit-request-${now.getTime()}`,
    service: "compromised-wallet-rescue",
    walletContext: {
      chainId: 196,
      sourceAddress: "0x1111111111111111111111111111111111111111",
      destinationAddress: "0x2222222222222222222222222222222222222222",
    },
    assetManifest: {
      erc20TokenAddresses: [
        "0x3333333333333333333333333333333333333333",
      ],
      erc721Assets: [],
      erc1155Assets: [],
    },
    authorization: {
      statement: SAFEEXIT_AUTHORIZATION_STATEMENT,
      confirmedAt: now.toISOString(),
    },
  };
}

export function createSafeExitRequestJsonSchema(
  baseUrl: string | URL,
  now: Date = new Date(),
): JsonObject {
  const generated = z.toJSONSchema(okxX402PrepareRequestSchema, {
    target: "draft-2020-12",
    io: "input",
  });
  const schema = JSON.parse(JSON.stringify(generated)) as JsonObject;
  schema.$id = absoluteUrl(baseUrl, SAFEEXIT_REQUEST_SCHEMA_PATH);
  schema.title = "Safe Exit paid rescue preparation request";
  schema.description =
    "Request accepted by the hosted Safe Exit x402 API service. No local Safe Exit daemon or filesystem access is required.";

  const properties = asJsonObject(schema.properties);
  const walletContext = asJsonObject(properties.walletContext);
  const walletProperties = asJsonObject(walletContext.properties);
  const chainId = asJsonObject(walletProperties.chainId);
  chainId.enum = [...RESCUE_MAINNET_CHAIN_IDS];

  const assetManifest = asJsonObject(properties.assetManifest);
  assetManifest.allOf = [
    {
      anyOf: [
        {
          properties: {
            erc20TokenAddresses: { minItems: 1 },
          },
        },
        {
          properties: {
            erc721Assets: { minItems: 1 },
          },
        },
        {
          properties: {
            erc1155Assets: { minItems: 1 },
          },
        },
      ],
    },
  ];

  schema.examples = [createSafeExitRequestExample(now)];
  schema["x-safeexit-cross-field-constraints"] = [
    "walletContext.sourceAddress must differ from walletContext.destinationAddress",
    "assetManifest must contain at least one explicit asset",
    "assetManifest may contain at most 16 assets in total",
    "duplicate asset entries are rejected",
  ];
  return schema;
}

export function createSafeExitServiceManifest(
  baseUrl: string | URL,
  now: Date = new Date(),
) {
  const endpointUrl = absoluteUrl(baseUrl, SAFEEXIT_PAID_PREPARE_PATH);
  const manifestUrl = absoluteUrl(baseUrl, SAFEEXIT_SERVICE_MANIFEST_PATH);
  const requestSchemaUrl = absoluteUrl(baseUrl, SAFEEXIT_REQUEST_SCHEMA_PATH);

  return {
    schemaVersion: SAFEEXIT_SERVICE_MANIFEST_VERSION,
    canonicalUrl: manifestUrl,
    agent: {
      id: SAFEEXIT_AGENT_ID,
      name: "Safe Exit",
    },
    service: {
      name: "Multi-Asset Rescue Plan",
      type: "API_SERVICE",
      execution: "PREPARE_ONLY",
      endpoint: {
        method: "POST",
        url: endpointUrl,
        contentType: "application/json",
        requestSchemaUrl,
      },
      payment: {
        protocol: "x402",
        network: SAFEEXIT_X402_NETWORK,
        price: SAFEEXIT_X402_PRICE,
        challenge: "HTTP_402_PAYMENT_REQUIRED",
      },
    },
    capabilities: {
      executionPaths: [
        "DIRECT_AUTHORIZATION",
        "SAFEEXIT_SETTLEMENT",
      ],
      supportedChains: rescueMainnetChainConfigs.map(({ chain }) => ({
        chainId: chain.id,
        name: chain.name,
      })),
      outputs: [
        "DETERMINISTIC_WALLET_SCAN",
        "DETERMINISTIC_RESCUE_PLAN",
        "SIMULATION_RESULTS",
        "ORDERED_SIGNING_PACKAGES",
        "OPTIONAL_DASHBOARD_URL",
      ],
    },
    runtimeRequirements: {
      hostedHttpsService: true,
      localDaemonRequired: false,
      localFilesystemAccessRequired: false,
      conversationHistoryAccessRequired: false,
    },
    security: {
      custody: "NON_CUSTODIAL",
      sourceSigning: "USER_CONTROLLED_LOCAL_SIGNER",
      privateCredentialsAccepted: false,
      arbitraryCalldataAccepted: false,
      prohibitedInputs: [
        "SEED_PHRASE",
        "PRIVATE_KEY",
        "KEYSTORE",
        "RAW_WALLET_CREDENTIALS",
        "LOCAL_CONVERSATION_HISTORY",
      ],
    },
    buyerAgentInstructions: [
      "Call the hosted HTTPS endpoint directly; do not look for a local Safe Exit process.",
      "Do not inspect local files, IDE conversations, or chat history to use this service.",
      "Send only public wallet addresses, explicit asset identifiers, and the exact authorization statement.",
      "Never request or transmit a seed phrase, private key, keystore, or raw wallet credential.",
      "Present the returned source, destination, routes, and simulations before requesting local signatures.",
    ],
    request: {
      schemaUrl: requestSchemaUrl,
      example: createSafeExitRequestExample(now),
      notes: [
        "Generate a unique requestId for every new rescue request.",
        "Set authorization.confirmedAt when the user confirms the request.",
        "buyerAgentId is optional.",
        "Unsupported assets remain visible as blocked or omitted results; they are never treated as executable.",
      ],
    },
  } as const;
}

export function applySafeExitServiceDiscoveryHeaders(
  headers: Headers,
  baseUrl: string | URL,
): void {
  const manifestUrl = absoluteUrl(baseUrl, SAFEEXIT_SERVICE_MANIFEST_PATH);
  const requestSchemaUrl = absoluteUrl(baseUrl, SAFEEXIT_REQUEST_SCHEMA_PATH);
  const discoveryLinks = [
    `<${manifestUrl}>; rel="service-desc"; type="application/json"`,
    `<${requestSchemaUrl}>; rel="describedby"; type="application/schema+json"`,
  ].join(", ");
  const existingLinks = headers.get("Link");

  headers.set(
    "Link",
    existingLinks ? `${existingLinks}, ${discoveryLinks}` : discoveryLinks,
  );
  headers.set("X-SafeExit-Service-Manifest", manifestUrl);
  headers.set("X-SafeExit-Local-Runtime", "not-required");
}

export function safeExitPublicDiscoveryHeaders(
  contentType: "application/json" | "application/schema+json",
): Record<string, string> {
  return {
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "no-store",
    "Content-Type": `${contentType}; charset=utf-8`,
  };
}
