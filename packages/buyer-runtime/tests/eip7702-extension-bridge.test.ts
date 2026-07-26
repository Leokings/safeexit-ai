import {
  EIP7702_ACTION_KIND,
  EIP7702_FULL_BALANCE,
  buildEip7702AuthorizationPair,
  eip7702RescueActionSchema,
  hashEip7702RescuePlan,
} from "@safeexit/adapters/eip7702-rescue";
import {
  eip7702LocalSigningPackageSchema,
  type Eip7702LocalSigningPackage,
} from "@safeexit/agent-service/eip7702-signing-package";
import { privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";

import {
  Eip7702ExtensionBridgeError,
  requestEip7702SourceSignerFromExtension,
  type SourceSignerBridgeMessage,
  type SourceSignerBridgeTransport,
} from "../src/eip7702-extension-bridge";

const source = privateKeyToAccount(
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
);
const destination = privateKeyToAccount(
  "0x59c6995e998f97a5a0044976f7d7f9f57f8f149ca2a5c6bede10b1b2b9f2d9b8",
);
const now = new Date("2026-07-25T10:00:00.000Z");

function signingPackage(): Eip7702LocalSigningPackage {
  const actions = [
    {
      kind: EIP7702_ACTION_KIND.TRANSFER_NATIVE,
      asset: "0x0000000000000000000000000000000000000000",
      counterparty: destination.address,
      tokenId: "0",
      amount: EIP7702_FULL_BALANCE.toString(),
    },
  ] as const;
  return eip7702LocalSigningPackageSchema.parse({
    schemaVersion: "safeexit-eip7702-signing-package-v1",
    packageId: "eip7702:package:extension-test",
    jobId: "job:extension-test",
    incidentId: "incident:extension-test",
    planId: "plan:extension-test",
    planHash: `0x${"55".repeat(32)}`,
    delegatePlanHash: hashEip7702RescuePlan(
      actions.map((action) => eip7702RescueActionSchema.parse({
        ...action,
        tokenId: BigInt(action.tokenId),
        amount: BigInt(action.amount),
      })),
    ),
    route: "EIP7702_DELEGATED_RESCUE",
    chainId: 196,
    sourceAddress: source.address,
    destinationAddress: destination.address,
    observedAtBlock: "100",
    expiresAt: "2026-07-25T10:10:00.000Z",
    deadline: Math.floor(Date.parse("2026-07-25T10:10:00.000Z") / 1_000),
    sourceNonce: 7,
    rescueNonce: `0x${"66".repeat(32)}`,
    factoryAddress: "0x1000000000000000000000000000000000000001",
    factoryRuntimeHash: `0x${"44".repeat(32)}`,
    delegateAddress: "0x2000000000000000000000000000000000000002",
    actionIds: ["action:native"],
    actions,
    executionIndexes: [0],
    simulation: {
      resultIds: ["simulation:native"],
      providerId: "xlayer-preflight",
      status: "SUCCEEDED",
      expiresAt: "2026-07-25T10:11:00.000Z",
    },
    policy: {
      sourceSignsLocally: true,
      destinationPaysAllGas: true,
      privateCredentialsAccepted: false,
      authorizationsReturnedToSafeExit: false,
      arbitraryCallsAllowed: false,
      postAuthorizationSimulationRequired: true,
      delegationClearRequired: true,
    },
  });
}

class FakeTransport implements SourceSignerBridgeTransport {
  readonly origin = "https://safeexit.xyz";
  readonly posted: unknown[] = [];
  private listeners = new Set<
    (message: SourceSignerBridgeMessage) => void
  >();
  onPost?: (message: unknown) => void;

  postMessage(message: unknown): void {
    this.posted.push(message);
    this.onPost?.(message);
  }

  subscribe(
    listener: (message: SourceSignerBridgeMessage) => void,
  ): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(data: unknown, overrides?: Partial<SourceSignerBridgeMessage>): void {
    for (const listener of this.listeners) {
      listener({
        origin: this.origin,
        sourceIsSelf: true,
        data,
        ...overrides,
      });
    }
  }
}

async function signedResult(value: Eip7702LocalSigningPackage) {
  const pair = buildEip7702AuthorizationPair({
    chainId: value.chainId,
    delegateAddress: value.delegateAddress,
    sourceNonce: value.sourceNonce,
  });
  const [rawDelegation, rawClearing] = await Promise.all([
    source.signAuthorization(pair.delegation),
    source.signAuthorization(pair.revocation),
  ]);
  const delegation = {
    address: rawDelegation.address,
    chainId: rawDelegation.chainId,
    nonce: Number(rawDelegation.nonce),
    yParity: rawDelegation.yParity,
    r: rawDelegation.r,
    s: rawDelegation.s,
  };
  const clearing = {
    address: rawClearing.address,
    chainId: rawClearing.chainId,
    nonce: Number(rawClearing.nonce),
    yParity: rawClearing.yParity,
    r: rawClearing.r,
    s: rawClearing.s,
  };
  return {
    pair,
    result: {
      schemaVersion: "safeexit-extension-authorizations-v1",
      packageId: value.packageId,
      chainId: value.chainId,
      sourceAddress: value.sourceAddress,
      destinationAddress: value.destinationAddress,
      planHash: value.planHash,
      expiresAt: value.expiresAt,
      delegationAuthorization: delegation,
      clearingAuthorization: clearing,
      destinationPaysGas: true,
      privateCredentialsIncluded: false,
    },
  } as const;
}

describe("EIP-7702 source-signer extension bridge", () => {
  it("returns a non-serializable, one-use signer after verifying both signatures", async () => {
    const value = signingPackage();
    const signed = await signedResult(value);
    const transport = new FakeTransport();
    transport.onPost = (message) => {
      const request = (message as {
        request?: { requestId: string };
      }).request;
      if (!request) return;
      const requestId = request.requestId;
      transport.emit({
        source: "safeexit-source-signer",
        channel: "safeexit-source-signer-v1",
        requestId,
        response: {
          status: "OK",
          method: "REVIEW_EIP7702_PACKAGE",
          signerState: "READY_FOR_EPHEMERAL_KEY",
          review: {},
        },
      });
      transport.emit({
        source: "safeexit-source-signer",
        channel: "safeexit-source-signer-v1",
        event: "EIP7702_AUTHORIZATIONS_SIGNED",
        requestId,
        result: signed.result,
      });
    };

    const signer = await requestEip7702SourceSignerFromExtension({
      signingPackageValue: value,
      transport,
      now,
      createRequestId: () => "request_extension_test",
    });

    expect(transport.posted.at(-1)).toEqual({
      source: "safeexit-web",
      channel: "safeexit-source-signer-v1",
      event: "EIP7702_AUTHORIZATIONS_ACCEPTED",
      requestId: "request_extension_test",
    });
    expect(await signer.getAddress()).toBe(source.address);
    expect(JSON.stringify(signer)).toBe("{}");
    expect(await signer.signAuthorization(signed.pair.delegation)).toEqual(
      signed.result.delegationAuthorization,
    );
    expect(await signer.signAuthorization(signed.pair.revocation)).toEqual(
      signed.result.clearingAuthorization,
    );
    await expect(
      signer.signAuthorization(signed.pair.revocation),
    ).rejects.toMatchObject({ code: "INVALID_AUTHORIZATION" });
  });

  it("rejects a signed result whose package commitments were substituted", async () => {
    const value = signingPackage();
    const signed = await signedResult(value);
    const transport = new FakeTransport();
    transport.onPost = (message) => {
      const requestId = (message as {
        request: { requestId: string };
      }).request.requestId;
      transport.emit({
        source: "safeexit-source-signer",
        channel: "safeexit-source-signer-v1",
        event: "EIP7702_AUTHORIZATIONS_SIGNED",
        requestId,
        result: {
          ...signed.result,
          destinationAddress:
            "0x4000000000000000000000000000000000000004",
        },
      });
    };

    await expect(
      requestEip7702SourceSignerFromExtension({
        signingPackageValue: value,
        transport,
        now,
        createRequestId: () => "request_tampered_test",
      }),
    ).rejects.toMatchObject({
      code: "INVALID_AUTHORIZATION",
    } satisfies Partial<Eip7702ExtensionBridgeError>);
  });

  it("ignores messages from another origin and times out fail-closed", async () => {
    const value = signingPackage();
    const transport = new FakeTransport();
    transport.onPost = () => {
      transport.emit(
        {
          source: "safeexit-source-signer",
          channel: "safeexit-source-signer-v1",
          requestId: "request_untrusted_test",
          response: {
            status: "ERROR",
            code: "INVALID_REQUEST",
            message: "untrusted",
          },
        },
        { origin: "https://attacker.invalid" },
      );
    };

    await expect(
      requestEip7702SourceSignerFromExtension({
        signingPackageValue: value,
        transport,
        now,
        timeoutMs: 5,
        createRequestId: () => "request_untrusted_test",
      }),
    ).rejects.toMatchObject({ code: "SIGNER_UNAVAILABLE" });
  });
});
