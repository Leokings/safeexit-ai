import {
  OkxA2AProviderBridge,
  OkxProviderBridgeError,
} from "@safeexit/okx-transport";
import { XLAYER_SAFEEXIT_EIP7702_FACTORY_V2 } from "@safeexit/buyer-runtime";
import { xLayerMainnetConfig } from "@safeexit/chain";

import { AgentHttpError } from "./agent-http";
import {
  getDeploymentRpcUrl,
  parseDeploymentEnvironment,
} from "./deployment-env";
import { LiveEip7702SigningPackageBuilder } from "./live-eip7702-signing-package-builder";

export function getOkxProviderBridge(): OkxA2AProviderBridge {
  const environment = parseDeploymentEnvironment();
  const providerAgentId = environment.okxProviderAgentId;
  if (!providerAgentId) {
    throw new AgentHttpError(
      503,
      "OKX_PROVIDER_BRIDGE_NOT_CONFIGURED",
      "OKX provider bridge is not configured for this deployment",
    );
  }
  const xLayerRpcUrl = getDeploymentRpcUrl(
    environment,
    xLayerMainnetConfig.chain.id,
  );
  const eip7702SigningPackages = xLayerRpcUrl
    ? new LiveEip7702SigningPackageBuilder(
        xLayerMainnetConfig,
        xLayerRpcUrl,
        XLAYER_SAFEEXIT_EIP7702_FACTORY_V2,
      )
    : undefined;
  return new OkxA2AProviderBridge(
    providerAgentId,
    undefined,
    undefined,
    undefined,
    eip7702SigningPackages,
  );
}

export function normalizeOkxBridgeError(error: unknown): unknown {
  if (error instanceof OkxProviderBridgeError) {
    return new AgentHttpError(409, error.code, error.message);
  }
  return error;
}
