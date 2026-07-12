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
    };
    if (
      config.nodeEnv === "production" &&
      config.publicBaseUrl === "https://safeexit.invalid"
    ) {
      throw new Error("SAFEEXIT_PUBLIC_BASE_URL must be configured in production");
    }
    if (config.agentMode === "HOSTED_REPLAY" && !config.agentApiKey) {
      throw new Error("SAFEEXIT_AGENT_API_KEY is required when the agent service is enabled");
    }
    if (config.agentMode === "HOSTED_REPLAY" && config.agentStore === "DATABASE") {
      await checkDatabaseConnection();
      checks.database = "connected";
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
