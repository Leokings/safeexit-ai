import {
  type DeploymentEnvironment,
  parseDeploymentEnvironment,
} from "./deployment-env";

export const SAFEEXIT_X402_NETWORK = "eip155:196" as const;
export const SAFEEXIT_X402_PRICE = "$0.10" as const;
export const SAFEEXIT_X402_MAX_TIMEOUT_SECONDS = 300;

export type SafeExitX402Configuration = {
  network: typeof SAFEEXIT_X402_NETWORK;
  payTo: string;
  price: typeof SAFEEXIT_X402_PRICE;
};

export type SafeExitX402RouteConfig = {
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
          body: object;
        };
      };
      schema: {
        $schema: "https://json-schema.org/draft/2020-12/schema";
        type: "object";
        properties: {
          input: {
            type: "object";
            properties: {
              type: { type: "string"; const: "http" };
              method: { type: "string"; enum: ["POST"] };
              bodyType: {
                type: "string";
                enum: ["json"];
              };
              body: Record<string, unknown>;
            };
            required: ["type", "method", "bodyType", "body"];
            additionalProperties: false;
          };
        };
        required: ["input"];
      };
    };
  };
  unpaidResponseBody: () => {
    contentType: "application/json";
    body: { code: string; message: string };
  };
};

export type SafeExitX402DiscoveryInput = {
  example: object;
  schema: Record<string, unknown>;
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

export function createSafeExitX402RouteConfig(
  configuration: SafeExitX402Configuration,
  discoveryInput: SafeExitX402DiscoveryInput,
): SafeExitX402RouteConfig {
  return {
    accepts: {
      scheme: "exact",
      network: configuration.network,
      payTo: configuration.payTo,
      price: configuration.price,
      maxTimeoutSeconds: SAFEEXIT_X402_MAX_TIMEOUT_SECONDS,
    },
    description:
      "Hosted provider API: prepare deterministic destination-paid SAFEEXIT rescue signing packages. A caller-managed buyer-agent runtime is required for payment, wallet signing, settlement, and receipt reporting; keep packages in memory unless the user requests an export.",
    mimeType: "application/json",
    extensions: {
      bazaar: {
        info: {
          input: {
            type: "http",
            method: "POST",
            bodyType: "json",
            body: discoveryInput.example,
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
                bodyType: { type: "string", enum: ["json"] },
                body: discoveryInput.schema,
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
          "A 0.1 USDT payment is required. Replay this resource with POST and the declared JSON rescue request to prepare the plan and signing packages.",
      },
    }),
  };
}
