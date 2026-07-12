import { describe, expect, it } from "vitest";

import { createHostedDemoState } from "./hosted-demo-fixture";
import { parseDeploymentEnvironment } from "./deployment-env";

describe("deployment environment", () => {
  it("keeps local execution and the agent disabled by default in development", () => {
    const config = parseDeploymentEnvironment({ NODE_ENV: "development" });
    expect(config.demoMode).toBe("LOCAL_ANVIL");
    expect(config.agentMode).toBe("DISABLED");
    expect(config.agentStore).toBe("MEMORY");
  });

  it("defaults production to a read-only demo and database persistence", () => {
    const config = parseDeploymentEnvironment({ NODE_ENV: "production" });
    expect(config.demoMode).toBe("HOSTED_REPLAY");
    expect(config.agentMode).toBe("DISABLED");
    expect(config.agentStore).toBe("DATABASE");
  });

  it("requires a sufficiently long server-side agent key", () => {
    expect(() =>
      parseDeploymentEnvironment({
        NODE_ENV: "production",
        SAFEEXIT_AGENT_API_KEY: "too-short",
      }),
    ).toThrow();
  });

  it("marks the hosted fixture as non-executable replay data", () => {
    const state = createHostedDemoState();
    expect(state.availability).toBe("READY");
    expect(state.executionMode).toBe("READ_ONLY_REPLAY");
    expect(state.actualState).toBe("AT_RISK");
  });
});
