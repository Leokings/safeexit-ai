import {
  type DeploymentEnvironment,
  parseDeploymentEnvironment,
} from "./deployment-env";

export const SAFEEXIT_X402_NETWORK = "eip155:196" as const;
export const SAFEEXIT_X402_PRICE = "$0.10" as const;
export const SAFEEXIT_X402_TOKEN_SYMBOL = "USD₮0" as const;
export const SAFEEXIT_X402_MAX_TIMEOUT_SECONDS = 300;

export type SafeExitX402Configuration = {
  network: typeof SAFEEXIT_X402_NETWORK;
  payTo: string;
  price: typeof SAFEEXIT_X402_PRICE;
};

type JsonObject = Record<string, unknown>;

export type SafeExitX402PostRouteConfig = {
  accepts: {
    scheme: "exact";
    network: typeof SAFEEXIT_X402_NETWORK;
    payTo: string;
    price: typeof SAFEEXIT_X402_PRICE;
    maxTimeoutSeconds: number;
  };
  description: string;
  mimeType: "application/json";
  extensions: {
    bazaar: {
      info: {
        input: {
          type: "http";
          method: "POST";
          bodyType: "json";
          body: JsonObject;
        };
      };
      schema: JsonObject;
    };
  };
  unpaidResponseBody: () => {
    contentType: "application/json";
    body: {
      code: string;
      message: string;
      requiredInput: {
        method: "POST";
        contentType: "application/json";
        requestSchemaUrl?: string;
        example: JsonObject;
      };
      marketplaceTaskGuidance: {
        mode: "DESIGNATED_X402";
        attachRequestBodyAtTaskCreation: true;
        useTaskLinkedPaymentReplay: true;
        saveResponseAsTaskDeliverable: true;
        completeOnlyAfterDeliverable: true;
        standalonePaymentDoesNotCompleteTask: true;
      };
    };
  };
};

export function getSafeExitX402Configuration(
  environment: DeploymentEnvironment = parseDeploymentEnvironment(),
): SafeExitX402Configuration {
  if (environment.x402Mode !== "MAINNET") {
    throw new Error("SAFEEXIT x402 payment is disabled");
  }
  if (
    !environment.okxWeb3ApiKey ||
    !environment.okxWeb3SecretKey ||
    !environment.okxWeb3Passphrase ||
    !environment.x402PayToAddress
  ) {
    throw new Error("SAFEEXIT x402 payment configuration is incomplete");
  }
  return {
    network: SAFEEXIT_X402_NETWORK,
    payTo: environment.x402PayToAddress,
    price: SAFEEXIT_X402_PRICE,
  };
}

export function createSafeExitX402PostRouteConfig(
  configuration: SafeExitX402Configuration,
  discovery: { schema: JsonObject; example: JsonObject },
): SafeExitX402PostRouteConfig {
  return {
    accepts: {
      scheme: "exact",
      network: configuration.network,
      payTo: configuration.payTo,
      price: configuration.price,
      maxTimeoutSeconds: SAFEEXIT_X402_MAX_TIMEOUT_SECONDS,
    },
    description:
      "Prepare a deterministic SAFEEXIT rescue plan and signing package from an explicit rescue request. The source wallet remains non-custodial and signs locally. For an OKX marketplace task, attach the JSON body when creating the designated x402 task and use its task-linked payment, replay, deliverable, and completion flow; do not substitute a standalone x402 payment.",
    mimeType: "application/json",
    extensions: {
      bazaar: {
        info: {
          input: {
            type: "http",
            method: "POST",
            bodyType: "json",
            body: discovery.example,
          },
        },
        schema: {
          $schema: "https://json-schema.org/draft/2020-12/schema",
          type: "object",
          properties: {
            input: {
              type: "object",
              properties: {
                type: { type: "string", const: "http" },
                method: { type: "string", enum: ["POST"] },
                bodyType: { type: "string", const: "json" },
                body: discovery.schema,
              },
              required: ["type", "method", "bodyType", "body"],
              additionalProperties: false,
            },
          },
          required: ["input"],
        },
      },
    },
    unpaidResponseBody: () => ({
      contentType: "application/json",
      body: {
        code: "PAYMENT_REQUIRED",
        message:
          `A 0.1 ${SAFEEXIT_X402_TOKEN_SYMBOL} payment is required to prepare this rescue request. Use POST with the JSON input below; an initial GET probe is supported only to obtain this payment challenge.`,
        requiredInput: {
          method: "POST",
          contentType: "application/json",
          ...(typeof discovery.schema.$id === "string"
            ? { requestSchemaUrl: discovery.schema.$id }
            : {}),
          example: discovery.example,
        },
        marketplaceTaskGuidance: {
          mode: "DESIGNATED_X402",
          attachRequestBodyAtTaskCreation: true,
          useTaskLinkedPaymentReplay: true,
          saveResponseAsTaskDeliverable: true,
          completeOnlyAfterDeliverable: true,
          standalonePaymentDoesNotCompleteTask: true,
        },
      },
    }),
  };
}

export function createSafeExitX402PrepareRouteConfigs(
  path: string,
  configuration: SafeExitX402Configuration,
  discovery: { schema: JsonObject; example: JsonObject },
): Record<string, SafeExitX402PostRouteConfig> {
  const config = createSafeExitX402PostRouteConfig(configuration, discovery);
  return {
    [`GET ${path}`]: config,
    [`POST ${path}`]: config,
  };
}
