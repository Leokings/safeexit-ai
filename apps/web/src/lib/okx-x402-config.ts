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
  unpaidResponseBody: () => {
    contentType: "application/json";
    body: { code: string; message: string };
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

export function createSafeExitX402RouteConfig(
  configuration: SafeExitX402Configuration,
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
      "Prepare a deterministic destination-paid SAFEEXIT rescue signing package",
    mimeType: "application/json",
    unpaidResponseBody: () => ({
      contentType: "application/json",
      body: {
        code: "PAYMENT_REQUIRED",
        message: "A 0.1 USDT payment is required to prepare this rescue package",
      },
    }),
  };
}
