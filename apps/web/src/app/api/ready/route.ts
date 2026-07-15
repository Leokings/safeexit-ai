import {
  checkDatabaseConnection,
  checkSharedRateLimitStore,
  getPrismaClient,
} from "@safeexit/persistence";

import { parseDeploymentEnvironment } from "@/lib/deployment-env";
import { probeConfiguredRpcEndpoints } from "@/lib/rpc-endpoints";
import {
  getSafeExitX402Configuration,
} from "@/lib/okx-x402";

export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  try {
    const config = parseDeploymentEnvironment();
    if (
      config.nodeEnv === "production" &&
      config.publicBaseUrl === "https://safeexit.invalid"
    ) {
      throw new Error("SAFEEXIT_PUBLIC_BASE_URL must be configured in production");
    }
    if (config.agentMode !== "DISABLED" && !config.agentApiKey) {
      throw new Error("SAFEEXIT_AGENT_API_KEY is required when the agent service is enabled");
    }
    if (config.agentMode !== "DISABLED") {
      if (!config.okxProviderAgentId) {
        throw new Error("SAFEEXIT_OKX_PROVIDER_AGENT_ID is required for the A2A bridge");
      }
    }
    if (config.x402Mode === "MAINNET") {
      getSafeExitX402Configuration(config);
    }
    if (config.agentMode !== "DISABLED" && config.agentStore === "DATABASE") {
      await checkDatabaseConnection();
    }
    if (config.nodeEnv === "production") {
      await checkSharedRateLimitStore(getPrismaClient());
    }
    if (config.agentMode === "LIVE_READONLY") {
      if (
        !config.okxWeb3ApiKey ||
        !config.okxWeb3SecretKey ||
        !config.okxWeb3Passphrase ||
        !config.xLayerMainnetRpcUrl
      ) {
        throw new Error("OKX Wallet API credentials and a dedicated RPC are required");
      }
    }
    await probeConfiguredRpcEndpoints(config);
    if (config.aiMode === "GATEWAY" && !config.aiModel?.includes("/")) {
      throw new Error("SAFEEXIT_AI_MODEL must use provider/model format");
    }
    return Response.json(
      { status: "ready" },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json(
      {
        status: "not_ready",
        message: "Required deployment dependencies are unavailable",
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
