import { describe, expect, it } from "vitest";

import { parseDeploymentEnvironment } from "./deployment-env";

describe("deployment environment", () => {
  it("keeps the agent disabled by default in development", () => {
    const config = parseDeploymentEnvironment({ NODE_ENV: "development" });
    expect(config.agentMode).toBe("DISABLED");
    expect(config.agentStore).toBe("MEMORY");
    expect(config.x402Mode).toBe("DISABLED");
    expect(config.aiMaxEstimatedInputTokens).toBe(12_000);
    expect(config.aiMaxOutputTokens).toBe(256);
    expect(config.aiTimeoutMs).toBe(8_000);
  });

  it("defaults production to a disabled agent and database persistence", () => {
    const config = parseDeploymentEnvironment({ NODE_ENV: "production" });
    expect(config.agentMode).toBe("DISABLED");
    expect(config.agentStore).toBe("DATABASE");
    expect(config.x402Mode).toBe("DISABLED");
  });

  it("treats empty pulled environment placeholders as not configured", () => {
    const config = parseDeploymentEnvironment({
      NODE_ENV: "development",
      SAFEEXIT_AGENT_MODE: "",
      SAFEEXIT_AGENT_API_KEY: "",
      OKX_WEB3_API_KEY: "",
      OKX_WEB3_SECRET_KEY: "",
      OKX_WEB3_PASSPHRASE: "",
      XLAYER_MAINNET_RPC_URL: "",
      VERCEL_GIT_COMMIT_SHA: "",
    });

    expect(config.agentMode).toBe("DISABLED");
    expect(config.agentApiKey).toBeUndefined();
    expect(config.okxWeb3ApiKey).toBeUndefined();
    expect(config.xLayerMainnetRpcUrl).toBeUndefined();
    expect(config.deploymentId).toBeUndefined();

    expect(() =>
      parseDeploymentEnvironment({
        NODE_ENV: "development",
        OKX_WEB3_API_KEY: "\n",
      }),
    ).toThrow();
  });

  it("requires a sufficiently long server-side agent key", () => {
    expect(() =>
      parseDeploymentEnvironment({
        NODE_ENV: "production",
        SAFEEXIT_AGENT_API_KEY: "too-short",
      }),
    ).toThrow();
  });

  it("accepts only a sufficiently long newline-free cron secret", () => {
    const config = parseDeploymentEnvironment({
      NODE_ENV: "production",
      CRON_SECRET: "c".repeat(40),
    });
    expect(config.cronSecret).toBe("c".repeat(40));
    expect(() => parseDeploymentEnvironment({
      NODE_ENV: "production",
      CRON_SECRET: `${"c".repeat(40)}\n`,
    })).toThrow();
    expect(() => parseDeploymentEnvironment({
      NODE_ENV: "production",
      CRON_SECRET: "too-short",
    })).toThrow();
  });

  it("parses server-only live discovery configuration", () => {
    const config = parseDeploymentEnvironment({
      NODE_ENV: "production",
      SAFEEXIT_AGENT_MODE: "LIVE_READONLY",
      OKX_WEB3_API_KEY: "api-key",
      OKX_WEB3_SECRET_KEY: "secret-key",
      OKX_WEB3_PASSPHRASE: "passphrase",
      XLAYER_MAINNET_RPC_URL: "https://xlayer.example/rpc",
      ETHEREUM_MAINNET_RPC_URL: "https://ethereum.example/rpc",
      SAFEEXIT_OKX_PROVIDER_AGENT_ID: "5196",
    });
    expect(config.agentMode).toBe("LIVE_READONLY");
    expect(config.okxWeb3ApiKey).toBe("api-key");
    expect(config.xLayerMainnetRpcUrl).toBe("https://xlayer.example/rpc");
    expect(config.ethereumMainnetRpcUrl).toBe("https://ethereum.example/rpc");
    expect(config.okxProviderAgentId).toBe("5196");
  });

  it("rejects a malformed OKX provider agent ID", () => {
    expect(() => parseDeploymentEnvironment({
      NODE_ENV: "production",
      SAFEEXIT_OKX_PROVIDER_AGENT_ID: "agent-5196",
    })).toThrow();
  });

  it("rejects line-broken credentials and non-HTTPS RPC endpoints", () => {
    expect(() => parseDeploymentEnvironment({
      NODE_ENV: "production",
      OKX_WEB3_API_KEY: "api-key\n",
    })).toThrow();
    expect(() => parseDeploymentEnvironment({
      NODE_ENV: "production",
      XLAYER_MAINNET_RPC_URL: "https://xlayer.example/rpc\n",
    })).toThrow();
    expect(() => parseDeploymentEnvironment({
      NODE_ENV: "production",
      XLAYER_MAINNET_RPC_URL: "http://xlayer.example/rpc",
    })).toThrow();
  });

  it("parses bounded hosted-model controls and rejects excessive output", () => {
    const config = parseDeploymentEnvironment({
      NODE_ENV: "production",
      SAFEEXIT_AI_MODE: "GATEWAY",
      SAFEEXIT_AI_MODEL: "deepseek/deepseek-v4-flash",
      SAFEEXIT_AI_MAX_ESTIMATED_INPUT_TOKENS: "8000",
      SAFEEXIT_AI_MAX_OUTPUT_TOKENS: "128",
      SAFEEXIT_AI_TIMEOUT_MS: "5000",
    });
    expect(config.aiModel).toBe("deepseek/deepseek-v4-flash");
    expect(config.aiMaxEstimatedInputTokens).toBe(8_000);
    expect(config.aiMaxOutputTokens).toBe(128);
    expect(config.aiTimeoutMs).toBe(5_000);

    expect(() => parseDeploymentEnvironment({
      NODE_ENV: "production",
      SAFEEXIT_AI_MAX_OUTPUT_TOKENS: "4096",
    })).toThrow();
  });

});
