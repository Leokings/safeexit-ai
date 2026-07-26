import { zeroAddress } from "viem";
import { describe, expect, it } from "vitest";

import { pendingSignerSessionSchema } from "../src/internal-protocol";
import {
  createEip7702ExtensionReview,
  handleSafeExitSignerRequest,
} from "../src/protocol";
import {
  delegateAddress,
  destinationAddress,
  now,
  signingPackageFixture as packageValue,
  sourceAddress,
} from "./fixtures";

describe("SafeExit source-signer extension protocol", () => {
  it("reports the extension-only ephemeral signer boundary", () => {
    expect(
      handleSafeExitSignerRequest({
        origin: "https://safeexit.xyz",
        requestValue: {
          requestId: "request_ping",
          method: "PING",
        },
        extensionVersion: "0.1.0",
        now,
      }),
    ).toEqual({
      status: "OK",
      method: "PING",
      extensionVersion: "0.1.0",
      signerState: "READY_FOR_EPHEMERAL_KEY",
      supportedChainIds: [196],
      privateCredentialsAccepted: false,
      extensionOnlyEphemeralKeyAccepted: true,
      destinationConnectsToExtension: false,
    });
  });

  it("accepts the local website and operator canary origins in the manifest", () => {
    for (const origin of [
      "http://127.0.0.1:3000",
      "http://localhost:3000",
      "http://127.0.0.1:4179",
      "http://localhost:4179",
    ] as const) {
      expect(
        handleSafeExitSignerRequest({
          origin,
          requestValue: {
            requestId: "request_canary_ping",
            method: "PING",
          },
          extensionVersion: "0.1.0",
          now,
        }),
      ).toMatchObject({
        status: "OK",
        method: "PING",
      });
    }
  });

  it("derives delegation and clearing requests from a pinned package", () => {
    const review = createEip7702ExtensionReview(packageValue(), now);
    expect("status" in review).toBe(false);
    if ("status" in review) return;

    expect(review.sourceAddress).toBe(sourceAddress);
    expect(review.destinationAddress).toBe(destinationAddress);
    expect(review.delegationAuthorization).toEqual({
      chainId: 196,
      address: delegateAddress,
      nonce: 7,
    });
    expect(review.clearingAuthorization).toEqual({
      chainId: 196,
      address: zeroAddress,
      nonce: 8,
    });
    expect(review.destinationConnectsToExtension).toBe(false);
    expect(review.privateCredentialsAccepted).toBe(false);
  });

  it("rejects requests from every non-SafeExit origin", () => {
    expect(
      handleSafeExitSignerRequest({
        origin: "https://safeexit.example",
        requestValue: {
          requestId: "request_bad_origin",
          method: "PING",
        },
        extensionVersion: "0.1.0",
        now,
      }),
    ).toMatchObject({
      status: "ERROR",
      code: "UNTRUSTED_ORIGIN",
    });
  });

  it("rejects expired signing packages", () => {
    const response = createEip7702ExtensionReview(
      packageValue(),
      new Date("2026-07-25T10:10:01.000Z"),
    );
    expect(response).toMatchObject({
      status: "ERROR",
      code: "PACKAGE_EXPIRED",
    });
  });

  it("rejects packages that do not use the pinned factory", () => {
    const response = createEip7702ExtensionReview(
      {
        ...packageValue(),
        factoryAddress: "0x5000000000000000000000000000000000000005",
      },
      now,
    );
    expect(response).toMatchObject({
      status: "ERROR",
      code: "UNTRUSTED_FACTORY",
    });
  });

  it("rejects undeclared credential fields", () => {
    const response = handleSafeExitSignerRequest({
      origin: "https://safeexit.xyz",
      requestValue: {
        requestId: "request_with_secret",
        method: "REVIEW_EIP7702_PACKAGE",
        signingPackage: {
          ...packageValue(),
          privateKey: `0x${"ab".repeat(32)}`,
        },
      },
      extensionVersion: "0.1.0",
      now,
    });
    expect(response).toMatchObject({
      status: "ERROR",
      code: "INVALID_REQUEST",
    });
  });

  it("rejects private credential fields from session storage", () => {
    const review = createEip7702ExtensionReview(packageValue(), now);
    expect("status" in review).toBe(false);
    if ("status" in review) return;

    expect(
      pendingSignerSessionSchema.safeParse({
        schemaVersion: "safeexit-pending-signer-session-v1",
        sessionId: "1f1dd5f0-b280-4699-a709-8ea8cdd55a4c",
        requestId: "request_session",
        origin: "https://safeexit.xyz",
        tabId: 7,
        stagedAt: now.toISOString(),
        review,
        privateKey: `0x${"ab".repeat(32)}`,
      }).success,
    ).toBe(false);
  });

  it("stores operator canary sessions only for explicitly trusted origins", () => {
    const review = createEip7702ExtensionReview(packageValue(), now);
    expect("status" in review).toBe(false);
    if ("status" in review) return;

    expect(
      pendingSignerSessionSchema.safeParse({
        schemaVersion: "safeexit-pending-signer-session-v1",
        sessionId: "1f1dd5f0-b280-4699-a709-8ea8cdd55a4c",
        requestId: "request_canary_session",
        origin: "http://127.0.0.1:4179",
        tabId: 7,
        stagedAt: now.toISOString(),
        review,
      }).success,
    ).toBe(true);
  });
});
