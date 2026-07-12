import { z } from "zod";

const deploymentEnvironmentSchema = z.strictObject({
  nodeEnv: z.enum(["development", "test", "production"]),
  publicBaseUrl: z.string().url(),
  demoMode: z.enum(["LOCAL_ANVIL", "HOSTED_REPLAY", "DISABLED"]),
  agentMode: z.enum(["HOSTED_REPLAY", "LIVE_READONLY", "DISABLED"]),
  agentStore: z.enum(["MEMORY", "DATABASE"]),
  agentApiKey: z.string().min(32).optional(),
  okxWeb3ApiKey: z.string().min(1).optional(),
  okxWeb3SecretKey: z.string().min(1).optional(),
  okxWeb3Passphrase: z.string().min(1).optional(),
  xLayerMainnetRpcUrl: z.string().url().optional(),
  xLayerTestnetRpcUrl: z.string().url().optional(),
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
    demoMode:
      environment.SAFEEXIT_DEMO_MODE ??
      (production ? "HOSTED_REPLAY" : "LOCAL_ANVIL"),
    agentMode: environment.SAFEEXIT_AGENT_MODE ?? "DISABLED",
    agentStore:
      environment.SAFEEXIT_AGENT_STORE ?? (production ? "DATABASE" : "MEMORY"),
    agentApiKey: environment.SAFEEXIT_AGENT_API_KEY,
    okxWeb3ApiKey: environment.OKX_WEB3_API_KEY,
    okxWeb3SecretKey: environment.OKX_WEB3_SECRET_KEY,
    okxWeb3Passphrase: environment.OKX_WEB3_PASSPHRASE,
    xLayerMainnetRpcUrl: environment.XLAYER_MAINNET_RPC_URL,
    xLayerTestnetRpcUrl: environment.XLAYER_TESTNET_RPC_URL,
    deploymentId:
      environment.VERCEL_GIT_COMMIT_SHA ?? environment.SAFEEXIT_DEPLOYMENT_ID,
  });
}
