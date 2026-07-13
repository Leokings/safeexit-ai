import { OKXFacilitatorClient } from "@okxweb3/x402-core";
import { ExactEvmScheme } from "@okxweb3/x402-evm/exact/server";
import {
  x402ResourceServer,
} from "@okxweb3/x402-next";

import type { DeploymentEnvironment } from "./deployment-env";
import { parseDeploymentEnvironment } from "./deployment-env";
import { getSafeExitX402Configuration } from "./okx-x402-config";

export * from "./okx-x402-config";

export function createSafeExitX402ResourceServer(
  environment: DeploymentEnvironment = parseDeploymentEnvironment(),
): x402ResourceServer {
  const configuration = getSafeExitX402Configuration(environment);
  const facilitator = new OKXFacilitatorClient({
    apiKey: environment.okxWeb3ApiKey!,
    secretKey: environment.okxWeb3SecretKey!,
    passphrase: environment.okxWeb3Passphrase!,
  });
  return new x402ResourceServer(facilitator).register(
    configuration.network,
    new ExactEvmScheme(),
  );
}
