import {
  OkxA2AProviderBridge,
  OkxProviderBridgeError,
} from "@safeexit/okx-transport";

import { AgentHttpError } from "./agent-http";
import { parseDeploymentEnvironment } from "./deployment-env";

export function getOkxProviderBridge(): OkxA2AProviderBridge {
  const providerAgentId = parseDeploymentEnvironment().okxProviderAgentId;
  if (!providerAgentId) {
    throw new AgentHttpError(
      503,
      "OKX_PROVIDER_BRIDGE_NOT_CONFIGURED",
      "OKX provider bridge is not configured for this deployment",
    );
  }
  return new OkxA2AProviderBridge(providerAgentId);
}

export function normalizeOkxBridgeError(error: unknown): unknown {
  if (error instanceof OkxProviderBridgeError) {
    return new AgentHttpError(409, error.code, error.message);
  }
  return error;
}
