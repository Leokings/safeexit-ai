import { describe, expect, it, vi } from "vitest";

import {
  ApiInputError,
  createContentSecurityPolicy,
  createIncidentRequestSchema,
  createSecureLogger,
  createSecurityHeaders,
  InMemoryRateLimiter,
  parseApiSecurityEnvironment,
  parseJsonBody,
  redactSensitive,
  SharedRateLimiter,
} from "../src";

const source = "0x1111111111111111111111111111111111111111";
const destination = "0x2222222222222222222222222222222222222222";
const token = "0x3333333333333333333333333333333333333333";
const assetManifest = {
  erc20TokenAddresses: [token],
  erc721Assets: [],
  erc1155Assets: [],
};

describe("secure API validation", () => {
  it("accepts an authorised incident request", () => {
    expect(
      createIncidentRequestSchema.parse({
        chainId: 196,
        sourceAddress: source,
        destinationAddress: destination,
        assetManifest,
        authorizationConfirmed: true,
      }),
    ).toMatchObject({ chainId: 196, authorizationConfirmed: true });
  });

  it("rejects credential fields and identical addresses", () => {
    expect(() =>
      createIncidentRequestSchema.parse({
        chainId: 196,
        sourceAddress: source,
        destinationAddress: source,
        assetManifest,
        authorizationConfirmed: true,
        privateKey: "never-store-this",
      }),
    ).toThrow();
  });

  it("requires a bounded explicit asset manifest", () => {
    expect(() =>
      createIncidentRequestSchema.parse({
        chainId: 196,
        sourceAddress: source,
        destinationAddress: destination,
        assetManifest: {
          erc20TokenAddresses: [],
          erc721Assets: [],
          erc1155Assets: [],
        },
        authorizationConfirmed: true,
      }),
    ).toThrow();

    expect(() =>
      createIncidentRequestSchema.parse({
        chainId: 196,
        sourceAddress: source,
        destinationAddress: destination,
        assetManifest: {
          erc20TokenAddresses: [token, token.toUpperCase().replace("0X", "0x")],
          erc721Assets: [],
          erc1155Assets: [],
        },
        authorizationConfirmed: true,
      }),
    ).toThrow();
  });

  it("enforces JSON content type and body size", async () => {
    const wrongType = new Request("http://localhost/api/incidents", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "{}",
    });
    await expect(parseJsonBody(wrongType, createIncidentRequestSchema)).rejects.toMatchObject({
      code: "INVALID_CONTENT_TYPE",
      status: 415,
    } satisfies Partial<ApiInputError>);

    const oversized = new Request("http://localhost/api/incidents", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ value: "x".repeat(200) }),
    });
    await expect(
      parseJsonBody(oversized, createIncidentRequestSchema, { maxBytes: 32 }),
    ).rejects.toMatchObject({ code: "BODY_TOO_LARGE", status: 413 });
  });

  it("validates rate-limit environment settings", () => {
    expect(
      parseApiSecurityEnvironment({
        SAFEEXIT_RATE_LIMIT_MAX_REQUESTS: "12",
        SAFEEXIT_RATE_LIMIT_WINDOW_MS: "30000",
      }),
    ).toEqual({ maxRequests: 12, windowMs: 30_000 });
    expect(() =>
      parseApiSecurityEnvironment({ SAFEEXIT_RATE_LIMIT_MAX_REQUESTS: "0" }),
    ).toThrow();
  });
});

describe("rate limiting", () => {
  it("blocks requests over the limit and resets after the window", () => {
    const limiter = new InMemoryRateLimiter(2, 1_000);
    expect(limiter.consume("client", 10_000)).toMatchObject({
      allowed: true,
      remaining: 1,
    });
    expect(limiter.consume("client", 10_100)).toMatchObject({
      allowed: true,
      remaining: 0,
    });
    expect(limiter.consume("client", 10_200)).toMatchObject({
      allowed: false,
      remaining: 0,
    });
    expect(limiter.consume("client", 11_000)).toMatchObject({
      allowed: true,
      remaining: 1,
    });
  });

  it("uses an atomic shared store decision across instances", async () => {
    let count = 0;
    let resetAt = new Date(11_000);
    const increment = vi.fn(async (input: { now: Date; resetAt: Date }) => {
      if (resetAt <= input.now) {
        count = 0;
        resetAt = input.resetAt;
      }
      count += 1;
      return { count, resetAt };
    });
    const firstInstance = new SharedRateLimiter(2, 1_000, { increment });
    const secondInstance = new SharedRateLimiter(2, 1_000, { increment });

    await expect(firstInstance.consume("client", 10_000)).resolves.toMatchObject({
      allowed: true,
      remaining: 1,
    });
    await expect(secondInstance.consume("client", 10_100)).resolves.toMatchObject({
      allowed: true,
      remaining: 0,
    });
    await expect(firstInstance.consume("client", 10_200)).resolves.toMatchObject({
      allowed: false,
      remaining: 0,
    });
    await expect(secondInstance.consume("client", 11_000)).resolves.toMatchObject({
      allowed: true,
      remaining: 1,
    });
  });

  it("fails closed when the shared store returns an invalid bucket", async () => {
    const limiter = new SharedRateLimiter(2, 1_000, {
      increment: async () => ({ count: 0, resetAt: new Date(0) }),
    });
    await expect(limiter.consume("client", 10_000)).rejects.toThrow(
      "Shared rate-limit store returned an invalid bucket",
    );
  });
});

describe("security headers", () => {
  it("uses a production CSP without unsafe-eval", () => {
    const policy = createContentSecurityPolicy(false);
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("https://rpc.xlayer.tech");
    expect(policy).toContain("https://xlayerrpc.okx.com");
    expect(policy).not.toContain("'unsafe-eval'");
    expect(createSecurityHeaders(false)).toContainEqual({
      key: "X-Content-Type-Options",
      value: "nosniff",
    });
  });

  it("permits the Next development runtime explicitly", () => {
    expect(createContentSecurityPolicy(true)).toContain("'unsafe-eval'");
    expect(createContentSecurityPolicy(true)).toContain("ws://localhost:*");
  });
});

describe("logging redaction", () => {
  it("redacts nested wallet secrets, calldata, signatures, and database URLs", () => {
    const redacted = redactSensitive({
      sourceAddress: source,
      nested: {
        seedPhrase: "one two three",
        private_key: "0xsecret",
        calldata: "0xdeadbeef",
        signature: "0xsigned",
      },
      message:
        "connection postgresql://safeexit:secret@localhost:5432/safeexit failed",
    });
    expect(redacted).toEqual({
      sourceAddress: source,
      nested: {
        seedPhrase: "[REDACTED]",
        private_key: "[REDACTED]",
        calldata: "[REDACTED]",
        signature: "[REDACTED]",
      },
      message: "connection [REDACTED] failed",
    });
  });

  it("writes only redacted structured context", () => {
    const info = vi.fn();
    const logger = createSecureLogger({ info, warn: vi.fn(), error: vi.fn() });
    logger.info("test", { mnemonic: "secret", incidentId: "incident-1" });
    expect(info).toHaveBeenCalledOnce();
    expect(info.mock.calls[0]?.[0]).toBe(
      '{"message":"test","mnemonic":"[REDACTED]","incidentId":"incident-1"}',
    );
  });
});
