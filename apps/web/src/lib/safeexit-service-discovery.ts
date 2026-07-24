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

const rescueNetworkPresentation: Record<
  number,
  { name: string; aliases: readonly string[] }
> = {
  1: { name: "Ethereum", aliases: ["Ethereum Mainnet", "ETH"] },
  56: { name: "BNB Smart Chain", aliases: ["BNB Chain", "BSC", "BNB"] },
  137: { name: "Polygon", aliases: ["Polygon PoS", "MATIC"] },
  42_161: { name: "Arbitrum", aliases: ["Arbitrum One", "ARB"] },
  10: { name: "Optimism", aliases: ["OP Mainnet", "OP"] },
  8_453: { name: "Base", aliases: ["Base Mainnet"] },
  43_114: { name: "Avalanche", aliases: ["Avalanche C-Chain", "AVAX"] },
  196: { name: "X Layer", aliases: ["X Layer Mainnet", "OKX X Layer"] },
};

function asJsonObject(value: unknown): JsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Expected a JSON object while publishing the request schema");
  }
  return value as JsonObject;
}

function absoluteUrl(baseUrl: string | URL, path: string): string {
  return new URL(path, baseUrl).toString();
}

export function createSafeExitNetworkChoices() {
  return rescueMainnetChainConfigs.map(({ chain }) => {
    const presentation = rescueNetworkPresentation[chain.id] ?? {
      name: chain.name,
      aliases: [],
    };
    return {
      name: presentation.name,
      chainId: chain.id,
      aliases: [...presentation.aliases],
    };
  });
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
    "Request accepted by the hosted Safe Exit x402 provider API. A caller-managed buyer-agent runtime, running as a local daemon or compatible hosted agent, is required for payment, wallet signing, settlement, and receipt reporting.";

  const properties = asJsonObject(schema.properties);
  const walletContext = asJsonObject(properties.walletContext);
  const walletProperties = asJsonObject(walletContext.properties);
  const chainId = asJsonObject(walletProperties.chainId);
  chainId.enum = [...RESCUE_MAINNET_CHAIN_IDS];
  chainId.description =
    "Internal numeric identifier. Buyer agents must ask the user to choose a network by name and map that choice to this value.";
  chainId["x-safeexit-user-facing-label"] = "Network";
  chainId["x-safeexit-network-choices"] = createSafeExitNetworkChoices();

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

export function createSafeExitX402ChallengeJsonSchema(
  baseUrl: string | URL,
  now: Date = new Date(),
): JsonObject {
  const schema = createSafeExitRequestJsonSchema(baseUrl, now);

  // Keep the 402 header comfortably below common proxy limits. The complete,
  // annotated schema remains available at the stable $id URL.
  delete schema.title;
  delete schema.description;
  delete schema.examples;
  delete schema["x-safeexit-cross-field-constraints"];

  const properties = asJsonObject(schema.properties);
  const walletContext = asJsonObject(properties.walletContext);
  const walletProperties = asJsonObject(walletContext.properties);
  const chainId = asJsonObject(walletProperties.chainId);
  delete chainId.description;
  delete chainId["x-safeexit-user-facing-label"];
  delete chainId["x-safeexit-network-choices"];
  delete chainId.exclusiveMinimum;
  delete chainId.maximum;

  const assetManifest = asJsonObject(properties.assetManifest);
  const assetProperties = asJsonObject(assetManifest.properties);
  for (const key of [
    "erc20TokenAddresses",
    "erc721Assets",
    "erc1155Assets",
  ]) {
    delete asJsonObject(assetProperties[key]).default;
  }

  const authorization = asJsonObject(properties.authorization);
  const authorizationProperties = asJsonObject(authorization.properties);
  delete asJsonObject(authorizationProperties.confirmedAt).pattern;

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
      description:
        "Prepare a deterministic multi-asset rescue plan and signing packages. When invoked through the OKX marketplace, create a designated x402 task with the complete request body attached, use the task-linked payment and replay flow, save the returned response as the task deliverable, and only then complete the task. A standalone x402 payment is not a marketplace-task purchase and cannot make that task reviewable.",
      endpoint: {
        method: "POST",
        url: endpointUrl,
        contentType: "application/json",
        requestSchemaUrl,
        paymentRequired: true,
        paymentReplayRequired: true,
        initialPaymentProbe: {
          method: "GET",
          purpose:
            "Obtain the x402 challenge only. The challenge declares the required POST JSON input; wallet and asset details must never appear in a GET URL.",
        },
        networkChoices: createSafeExitNetworkChoices(),
      },
      payment: {
        protocol: "x402",
        network: SAFEEXIT_X402_NETWORK,
        price: SAFEEXIT_X402_PRICE,
        challenge: "HTTP_402_PAYMENT_REQUIRED",
      },
      marketplaceTaskWorkflow: {
        mode: "DESIGNATED_X402",
        requestBodyRequiredAtTaskCreation: true,
        paymentMustBeTaskLinked: true,
        responseMustBeSavedAsTaskDeliverable: true,
        completeOnlyAfterDeliverable: true,
        standalonePaymentDoesNotCompleteTask: true,
        sequence: [
          "CREATE_TASK_WITH_REQUEST_BODY",
          "SET_X402_PAYMENT_MODE",
          "TASK_LINKED_PAYMENT_AND_POST_REPLAY",
          "SAVE_RESPONSE_AS_TASK_DELIVERABLE",
          "COMPLETE_TASK",
        ],
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
      providerRuntime: "SAFEEXIT_HOSTED",
      buyerAgentRuntimeRequired: true,
      buyerAgentRuntimeOwnership: "CALLER_MANAGED",
      buyerAgentRuntimeLocations: ["LOCAL_DAEMON", "CALLER_HOSTED"],
      buyerWalletExecutionRequired: true,
      localFilesystemAccessRequired: false,
      conversationHistoryAccessRequired: false,
      localArtifactPersistenceRequired: false,
    },
    security: {
      custody: "NON_CUSTODIAL",
      sourceSigning: "USER_CONTROLLED_LOCAL_SIGNER",
      signingPackageHandling: "MEMORY_ONLY_BY_DEFAULT",
      sourceSignaturesPersisted: false,
      signedAuthorizationsPersisted: false,
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
      "Use a caller-managed buyer-agent runtime, running as a local daemon or compatible hosted agent, to call the Safe Exit HTTPS API.",
      "For an OKX marketplace task, create a designated x402 task with the complete rescue JSON attached at task creation. Use the marketplace task-linked payment and POST replay flow, persist the returned response as that task's deliverable, and complete the task only after the deliverable is recorded.",
      "Never replace the marketplace task-linked payment step with a standalone x402 quote or payment. A standalone payment can return a valid Safe Exit response, but it is not linked to the marketplace task and therefore cannot complete that task or enable feedback.",
      "Before payment, fetch the free manifest and request schema. They provide the complete JSON Schema, a placeholder-only example, and friendly network choices. Show those to the user and collect each value before POSTing.",
      "Ask the user to choose a supported network by name, not numeric chain ID. Map their named choice to the provided chainId only when building the POST JSON.",
      "An initial GET probe to the paid endpoint is supported for generic marketplace clients. It returns the same HTTP 402 challenge and declares POST as the paid replay method; do not put wallet or asset details in a GET URL.",
      "Submit the complete valid JSON request to the paid POST endpoint. An unpaid request receives an HTTP 402 payment challenge before body validation. After the user confirms payment, replay that same JSON POST through the OKX Agent Payments Protocol to receive the rescue preparation result.",
      "The buyer-agent runtime handles x402 payment, source-wallet signing, destination settlement, and receipt reporting.",
      "Do not inspect unrelated local files, IDE conversations, or chat history to discover or use Safe Exit.",
      "Render rescue results directly and keep signing packages in memory by default.",
      "Do not create local files or artifacts unless the user explicitly requests an export.",
      "Never persist source signatures, signed authorizations, private credentials, or wallet secrets.",
      "Send only public wallet addresses, explicit asset identifiers, and the exact authorization statement.",
      "Never request or transmit a seed phrase, private key, keystore, or raw wallet credential.",
      "Present the returned source, destination, routes, and simulations before requesting local signatures.",
    ],
    request: {
      schemaUrl: requestSchemaUrl,
      example: createSafeExitRequestExample(now),
      notes: [
        "The endpoint returns an x402 challenge before validating an unpaid POST body. After payment verification, invalid POST data is rejected with structured 4xx field issues and is not settled.",
        "Replay the same complete JSON POST after the x402 payment is confirmed.",
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
  headers.set("X-SafeExit-Provider-Runtime", "hosted");
  headers.set("X-SafeExit-Buyer-Runtime", "required");
  headers.set("X-SafeExit-Local-Runtime", "buyer-managed");
  headers.set("X-SafeExit-Marketplace-Flow", "designated-x402-task");
  headers.set("X-SafeExit-Task-Payment", "task-linked-replay-required");
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
