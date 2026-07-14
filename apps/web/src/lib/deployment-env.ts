import { z } from "zod";

const deploymentEnvironmentSchema = z.strictObject({
  nodeEnv: z.enum(["development", "test", "production"]),
  publicBaseUrl: z.string().url(),
  agentMode: z.enum(["LIVE_READONLY", "DISABLED"]),
  agentStore: z.enum(["MEMORY", "DATABASE"]),
  aiMode: z.enum(["DETERMINISTIC", "GATEWAY"]),
  aiModel: z.string().min(3).max(128).optional(),
  aiMaxEstimatedInputTokens: z.coerce.number().int().min(512).max(32_000),
  aiMaxOutputTokens: z.coerce.number().int().min(32).max(512),
  aiTimeoutMs: z.coerce.number().int().min(1_000).max(15_000),
  agentApiKey: z.string().min(32).optional(),
  okxProviderAgentId: z.string().regex(/^\d{1,32}$/).optional(),
  okxWeb3ApiKey: z.string().min(1).optional(),
  okxWeb3SecretKey: z.string().min(1).optional(),
  okxWeb3Passphrase: z.string().min(1).optional(),
  x402Mode: z.enum(["DISABLED", "MAINNET"]),
  x402PayToAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional(),
  ethereumMainnetRpcUrl: z.string().url().optional(),
  bnbMainnetRpcUrl: z.string().url().optional(),
  polygonMainnetRpcUrl: z.string().url().optional(),
  arbitrumMainnetRpcUrl: z.string().url().optional(),
  optimismMainnetRpcUrl: z.string().url().optional(),
  baseMainnetRpcUrl: z.string().url().optional(),
  avalancheMainnetRpcUrl: z.string().url().optional(),
  xLayerMainnetRpcUrl: z.string().url().optional(),
  deploymentId: z.string().min(1).max(128).optional(),
});

export type DeploymentEnvironment = z.infer<typeof deploymentEnvironmentSchema>;

export function parseDeploymentEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
): DeploymentEnvironment {
  const nodeEnv = environment.NODE_ENV ?? "development";
  const production = nodeEnv === "production";
  return deploymentEnvironmentSchema.parse({
    nodeEnv,
    publicBaseUrl:
      environment.SAFEEXIT_PUBLIC_BASE_URL ??
      (production ? "https://safeexit.invalid" : "http://localhost:3000"),
    agentMode: environment.SAFEEXIT_AGENT_MODE ?? "DISABLED",
    agentStore:
      environment.SAFEEXIT_AGENT_STORE ?? (production ? "DATABASE" : "MEMORY"),
    aiMode: environment.SAFEEXIT_AI_MODE ?? "DETERMINISTIC",
    aiModel: environment.SAFEEXIT_AI_MODEL,
    aiMaxEstimatedInputTokens:
      environment.SAFEEXIT_AI_MAX_ESTIMATED_INPUT_TOKENS ?? "12000",
    aiMaxOutputTokens: environment.SAFEEXIT_AI_MAX_OUTPUT_TOKENS ?? "256",
    aiTimeoutMs: environment.SAFEEXIT_AI_TIMEOUT_MS ?? "8000",
    agentApiKey: environment.SAFEEXIT_AGENT_API_KEY,
    okxProviderAgentId: environment.SAFEEXIT_OKX_PROVIDER_AGENT_ID,
    okxWeb3ApiKey: environment.OKX_WEB3_API_KEY,
    okxWeb3SecretKey: environment.OKX_WEB3_SECRET_KEY,
    okxWeb3Passphrase: environment.OKX_WEB3_PASSPHRASE,
    x402Mode: environment.SAFEEXIT_X402_MODE ?? "DISABLED",
    x402PayToAddress: environment.SAFEEXIT_X402_PAY_TO_ADDRESS,
    ethereumMainnetRpcUrl: environment.ETHEREUM_MAINNET_RPC_URL,
    bnbMainnetRpcUrl: environment.BNB_MAINNET_RPC_URL,
    polygonMainnetRpcUrl: environment.POLYGON_MAINNET_RPC_URL,
    arbitrumMainnetRpcUrl: environment.ARBITRUM_MAINNET_RPC_URL,
    optimismMainnetRpcUrl: environment.OPTIMISM_MAINNET_RPC_URL,
    baseMainnetRpcUrl: environment.BASE_MAINNET_RPC_URL,
    avalancheMainnetRpcUrl: environment.AVALANCHE_MAINNET_RPC_URL,
    xLayerMainnetRpcUrl:
      environment.XLAYER_MAINNET_RPC_URL ?? environment.OKX_XLAYER_MAINNET_RPC_URL,
    deploymentId:
      environment.VERCEL_GIT_COMMIT_SHA ?? environment.SAFEEXIT_DEPLOYMENT_ID,
  });
}
