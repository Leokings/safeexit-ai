import {
  createDedicatedPublicClient,
  xLayerTestnetConfig,
} from "@safeexit/chain";
import {
  checkDatabaseConnection,
  checkSharedRateLimitStore,
  getPrismaClient,
} from "@safeexit/persistence";

import { parseDeploymentEnvironment } from "@/lib/deployment-env";
import { probeConfiguredRpcEndpoints } from "@/lib/rpc-endpoints";
import {
  getSafeExitX402Configuration,
  SAFEEXIT_X402_PRICE,
} from "@/lib/okx-x402";

export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  try {
    const config = parseDeploymentEnvironment();
    const checks: Record<string, string> = {
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
    if (config.agentMode !== "DISABLED") {
      if (!config.okxProviderAgentId) {
        throw new Error("SAFEEXIT_OKX_PROVIDER_AGENT_ID is required for the A2A bridge");
      }
      checks.okxProviderBridge = `configured:${config.okxProviderAgentId}`;
    }
    if (config.x402Mode === "MAINNET") {
      const x402 = getSafeExitX402Configuration(config);
      checks.paidAgentApi = `configured:${x402.network}:${SAFEEXIT_X402_PRICE}`;
    }
    if (config.agentMode !== "DISABLED" && config.agentStore === "DATABASE") {
      await checkDatabaseConnection();
      checks.database = "connected";
    }
    if (config.nodeEnv === "production") {
      await checkSharedRateLimitStore(getPrismaClient());
      checks.rateLimitStore = "shared:postgresql";
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
      checks.okxWalletApi = "configured";
    }
    Object.assign(checks, await probeConfiguredRpcEndpoints(config));
    if (config.nodeEnv === "production") {
      if (!config.xLayerTestnetRpcUrl) {
        throw new Error("XLAYER_TESTNET_RPC_URL is required for the signing pilot");
      }
      const testnetBlock = await createDedicatedPublicClient(
        xLayerTestnetConfig,
        config.xLayerTestnetRpcUrl,
      ).getBlockNumber();
      checks.xLayerTestnetRpc = `connected:${testnetBlock.toString()}`;
    }
    if (config.aiMode === "GATEWAY" && !config.aiModel?.includes("/")) {
      throw new Error("SAFEEXIT_AI_MODEL must use provider/model format");
    }
    checks.aiBudget = `${config.aiMaxEstimatedInputTokens}:${config.aiMaxOutputTokens}:${config.aiTimeoutMs}`;
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
