import { z } from "zod";

const httpsUrlSchema = z.string().max(2_048).superRefine((value, context) => {
  if (value !== value.trim() || /[\r\n]/.test(value)) {
    context.addIssue({ code: "custom", message: "URL must not contain surrounding whitespace" });
    return;
  }
  try {
    if (new URL(value).protocol !== "https:") {
      context.addIssue({ code: "custom", message: "Production RPC URL must use HTTPS" });
    }
  } catch {
    context.addIssue({ code: "custom", message: "Production RPC URL must be valid" });
  }
});

const serverCredentialSchema = z.string().min(1).max(1_024).refine(
  (value) => !/[\r\n]/.test(value),
  "Server credential must not contain line breaks",
);

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
  agentApiKey: serverCredentialSchema.min(32).optional(),
  cronSecret: serverCredentialSchema.min(32).optional(),
  okxProviderAgentId: z.string().regex(/^\d{1,32}$/).optional(),
  okxWeb3ApiKey: serverCredentialSchema.optional(),
  okxWeb3SecretKey: serverCredentialSchema.optional(),
  okxWeb3Passphrase: serverCredentialSchema.optional(),
  x402Mode: z.enum(["DISABLED", "MAINNET"]),
  x402PayToAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional(),
  ethereumMainnetRpcUrl: httpsUrlSchema.optional(),
  bnbMainnetRpcUrl: httpsUrlSchema.optional(),
  polygonMainnetRpcUrl: httpsUrlSchema.optional(),
  arbitrumMainnetRpcUrl: httpsUrlSchema.optional(),
  optimismMainnetRpcUrl: httpsUrlSchema.optional(),
  baseMainnetRpcUrl: httpsUrlSchema.optional(),
  avalancheMainnetRpcUrl: httpsUrlSchema.optional(),
  xLayerMainnetRpcUrl: httpsUrlSchema.optional(),
  deploymentId: z.string().min(1).max(128).optional(),
});

export type DeploymentEnvironment = z.infer<typeof deploymentEnvironmentSchema>;

function configured(value: string | undefined): string | undefined {
  return value === "" ? undefined : value;
}

export function getDeploymentRpcUrl(
  config: DeploymentEnvironment,
  chainId: number,
): string | undefined {
  switch (chainId) {
    case 1:
      return config.ethereumMainnetRpcUrl;
    case 56:
      return config.bnbMainnetRpcUrl;
    case 137:
      return config.polygonMainnetRpcUrl;
    case 42_161:
      return config.arbitrumMainnetRpcUrl;
    case 10:
      return config.optimismMainnetRpcUrl;
    case 8_453:
      return config.baseMainnetRpcUrl;
    case 43_114:
      return config.avalancheMainnetRpcUrl;
    case 196:
      return config.xLayerMainnetRpcUrl;
    default:
      return undefined;
  }
}

export function parseDeploymentEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
): DeploymentEnvironment {
  const nodeEnv = configured(environment.NODE_ENV) ?? "development";
  const production = nodeEnv === "production";
  return deploymentEnvironmentSchema.parse({
    nodeEnv,
    publicBaseUrl:
      configured(environment.SAFEEXIT_PUBLIC_BASE_URL) ??
      (production ? "https://safeexit.invalid" : "http://localhost:3000"),
    agentMode: configured(environment.SAFEEXIT_AGENT_MODE) ?? "DISABLED",
    agentStore:
      configured(environment.SAFEEXIT_AGENT_STORE) ??
      (production ? "DATABASE" : "MEMORY"),
    aiMode: configured(environment.SAFEEXIT_AI_MODE) ?? "DETERMINISTIC",
    aiModel: configured(environment.SAFEEXIT_AI_MODEL),
    aiMaxEstimatedInputTokens:
      configured(environment.SAFEEXIT_AI_MAX_ESTIMATED_INPUT_TOKENS) ?? "12000",
    aiMaxOutputTokens:
      configured(environment.SAFEEXIT_AI_MAX_OUTPUT_TOKENS) ?? "256",
    aiTimeoutMs: configured(environment.SAFEEXIT_AI_TIMEOUT_MS) ?? "8000",
    agentApiKey: configured(environment.SAFEEXIT_AGENT_API_KEY),
    cronSecret: configured(environment.CRON_SECRET),
    okxProviderAgentId: configured(environment.SAFEEXIT_OKX_PROVIDER_AGENT_ID),
    okxWeb3ApiKey: configured(environment.OKX_WEB3_API_KEY),
    okxWeb3SecretKey: configured(environment.OKX_WEB3_SECRET_KEY),
    okxWeb3Passphrase: configured(environment.OKX_WEB3_PASSPHRASE),
    x402Mode: configured(environment.SAFEEXIT_X402_MODE) ?? "DISABLED",
    x402PayToAddress: configured(environment.SAFEEXIT_X402_PAY_TO_ADDRESS),
    ethereumMainnetRpcUrl: configured(environment.ETHEREUM_MAINNET_RPC_URL),
    bnbMainnetRpcUrl: configured(environment.BNB_MAINNET_RPC_URL),
    polygonMainnetRpcUrl: configured(environment.POLYGON_MAINNET_RPC_URL),
    arbitrumMainnetRpcUrl: configured(environment.ARBITRUM_MAINNET_RPC_URL),
    optimismMainnetRpcUrl: configured(environment.OPTIMISM_MAINNET_RPC_URL),
    baseMainnetRpcUrl: configured(environment.BASE_MAINNET_RPC_URL),
    avalancheMainnetRpcUrl: configured(environment.AVALANCHE_MAINNET_RPC_URL),
    xLayerMainnetRpcUrl:
      configured(environment.XLAYER_MAINNET_RPC_URL) ??
      configured(environment.OKX_XLAYER_MAINNET_RPC_URL),
    deploymentId:
      configured(environment.VERCEL_GIT_COMMIT_SHA) ??
      configured(environment.SAFEEXIT_DEPLOYMENT_ID),
  });
}
