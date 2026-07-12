import { createDedicatedPublicClient, xLayerMainnetConfig } from "@safeexit/chain";
import { checkDatabaseConnection } from "@safeexit/persistence";

import { parseDeploymentEnvironment } from "@/lib/deployment-env";

export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  try {
    const config = parseDeploymentEnvironment();
    const checks: Record<string, string> = {
      demo: config.demoMode,
      agent: config.agentMode,
      store: config.agentStore,
      ai: config.aiMode,
    };
    if (
      config.nodeEnv === "production" &&
      config.publicBaseUrl === "https://safeexit.invalid"
    ) {
      throw new Error("SAFEEXIT_PUBLIC_BASE_URL must be configured in production");
    }
    if (config.agentMode !== "DISABLED" && !config.agentApiKey) {
      throw new Error("SAFEEXIT_AGENT_API_KEY is required when the agent service is enabled");
    }
    if (config.agentMode !== "DISABLED" && config.agentStore === "DATABASE") {
      await checkDatabaseConnection();
      checks.database = "connected";
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
      const block = await createDedicatedPublicClient(
        xLayerMainnetConfig,
        config.xLayerMainnetRpcUrl,
      ).getBlockNumber();
      checks.xLayerRpc = `connected:${block.toString()}`;
      checks.okxWalletApi = "configured";
    }
    if (config.aiMode === "GATEWAY" && !config.aiModel?.includes("/")) {
      throw new Error("SAFEEXIT_AI_MODEL must use provider/model format");
    }
    return Response.json(
      { status: "ready", checks },
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
