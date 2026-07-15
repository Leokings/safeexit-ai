import { describe, expect, it } from "vitest";

import { parseDeploymentEnvironment } from "./deployment-env";
import {
  PaidContinuationError,
  issuePaidContinuation,
  verifyPaidContinuation,
} from "./paid-continuation";

const now = new Date("2026-07-15T00:00:00.000Z");
const config = parseDeploymentEnvironment({
  NODE_ENV: "test",
  SAFEEXIT_PUBLIC_BASE_URL: "https://safeexit.xyz",
  SAFEEXIT_AGENT_MODE: "LIVE_READONLY",
  SAFEEXIT_AGENT_STORE: "MEMORY",
  SAFEEXIT_AGENT_API_KEY: "test-agent-api-key-that-is-long-enough-for-validation",
  SAFEEXIT_OKX_PROVIDER_AGENT_ID: "5196",
});
const scope = {
  requestId: "paid-request-1",
  safeExitJobId: "job:paid-1",
  providerAgentId: "5196",
  chainId: 196,
} as const;

describe("paid continuation", () => {
  it("issues a scoped token without exposing the agent API credential", () => {
    const continuation = issuePaidContinuation(config, scope, now);
    const verified = verifyPaidContinuation(
      config,
      continuation.token,
      scope,
      new Date("2026-07-15T00:01:00.000Z"),
    );

    expect(continuation.refreshUrl).toBe(
      "https://safeexit.xyz/api/agent/okx/refresh-paid",
    );
    expect(verified).toEqual(scope);
    expect(continuation.token).not.toContain(config.agentApiKey);
  });

  it("rejects tampering, scope substitution, and expiry", () => {
    const continuation = issuePaidContinuation(config, scope, now);
    const last = continuation.token.at(-1);
    const tampered = `${continuation.token.slice(0, -1)}${last === "a" ? "b" : "a"}`;

    expect(() => verifyPaidContinuation(config, tampered, scope, now)).toThrow(
      PaidContinuationError,
    );
    expect(() => verifyPaidContinuation(config, continuation.token, {
      ...scope,
      safeExitJobId: "job:other",
    }, now)).toThrow("out of scope");
    expect(() => verifyPaidContinuation(
      config,
      continuation.token,
      scope,
      new Date("2026-07-16T00:00:00.001Z"),
    )).toThrow("expired");
  });
});
