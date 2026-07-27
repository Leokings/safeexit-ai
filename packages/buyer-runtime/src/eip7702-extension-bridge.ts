/// <reference lib="dom" />

import {
  buildEip7702AuthorizationPair,
} from "@safeexit/adapters/eip7702-rescue";
import {
  eip7702LocalSigningPackageSchema,
  type Eip7702LocalSigningPackage,
} from "@safeexit/agent-service/eip7702-signing-package";
import {
  getAddress,
  type AuthorizationRequest,
  type SignedAuthorization,
} from "viem";
import { recoverAuthorizationAddress } from "viem/utils";
import { z } from "zod";

const CHANNEL = "safeexit-source-signer-v1" as const;
const WEB_SOURCE = "safeexit-web" as const;
const EXTENSION_SOURCE = "safeexit-source-signer" as const;

const requestIdSchema = z
  .string()
  .min(8)
  .max(128)
  .regex(/^[a-zA-Z0-9:_-]+$/);

const signedAuthorizationSchema = z.strictObject({
  address: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  chainId: z.literal(196),
  nonce: z.number().int().nonnegative().safe(),
  yParity: z.union([z.literal(0), z.literal(1)]),
  r: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
  s: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
});

const extensionSigningResultSchema = z.strictObject({
  schemaVersion: z.literal("safeexit-extension-authorizations-v1"),
  packageId: z.string().min(1).max(256),
  chainId: z.literal(196),
  sourceAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  destinationAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  planHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
  expiresAt: z.string().datetime({ offset: true }),
  delegationAuthorization: signedAuthorizationSchema,
  clearingAuthorization: signedAuthorizationSchema,
  destinationPaysGas: z.literal(true),
  privateCredentialsIncluded: z.literal(false),
});

const extensionStatusResponseSchema = z.strictObject({
  status: z.literal("OK"),
  method: z.literal("PING"),
  extensionVersion: z.string().min(1).max(32),
  signerState: z.literal("READY_FOR_EPHEMERAL_KEY"),
  supportedChainIds: z.tuple([z.literal(196)]),
  privateCredentialsAccepted: z.literal(false),
  extensionOnlyEphemeralKeyAccepted: z.literal(true),
  destinationConnectsToExtension: z.literal(false),
});

const extensionResponseEnvelopeSchema = z.strictObject({
  source: z.literal(EXTENSION_SOURCE),
  channel: z.literal(CHANNEL),
  requestId: requestIdSchema,
  response: z.union([
    extensionStatusResponseSchema,
    z.strictObject({
      status: z.literal("OK"),
      method: z.literal("REVIEW_EIP7702_PACKAGE"),
      signerState: z.literal("READY_FOR_EPHEMERAL_KEY"),
      review: z.unknown(),
    }),
    z.strictObject({
      status: z.literal("ERROR"),
      code: z.string().min(1).max(64),
      message: z.string().min(1).max(500),
    }),
  ]),
});

const extensionSigningEventSchema = z.strictObject({
  source: z.literal(EXTENSION_SOURCE),
  channel: z.literal(CHANNEL),
  event: z.literal("EIP7702_AUTHORIZATIONS_SIGNED"),
  requestId: requestIdSchema,
  result: extensionSigningResultSchema,
});

export type Eip7702ExtensionAuthorizationSigner = Readonly<{
  getAddress(): Promise<`0x${string}`>;
  signAuthorization(
    request: AuthorizationRequest,
  ): Promise<SignedAuthorization>;
}>;

export type SourceSignerBridgeMessage = Readonly<{
  origin: string;
  sourceIsSelf: boolean;
  data: unknown;
}>;

export type SourceSignerBridgeTransport = Readonly<{
  origin: string;
  postMessage(message: unknown): void;
  subscribe(
    listener: (message: SourceSignerBridgeMessage) => void,
  ): () => void;
}>;

export type Eip7702SourceSignerAvailability =
  | Readonly<{
      status: "AVAILABLE";
      extensionVersion: string;
      supportedChainIds: readonly [196];
    }>
  | Readonly<{
      status: "UNAVAILABLE";
    }>;

export class Eip7702ExtensionBridgeError extends Error {
  constructor(
    readonly code:
      | "ABORTED"
      | "EXTENSION_REJECTED"
      | "INVALID_AUTHORIZATION"
      | "INVALID_PACKAGE"
      | "PACKAGE_EXPIRED"
      | "SIGNER_UNAVAILABLE",
    message: string,
  ) {
    super(message);
    this.name = "Eip7702ExtensionBridgeError";
  }
}

type SignerState = {
  index: 0 | 1;
  requests: readonly [AuthorizationRequest, AuthorizationRequest];
  authorizations: readonly [SignedAuthorization, SignedAuthorization];
};

const signerStates = new WeakMap<
  Eip7702ExtensionAuthorizationSigner,
  SignerState
>();

function sameAddress(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function requestAddress(request: AuthorizationRequest): `0x${string}` {
  const value = "address" in request
    ? request.address
    : request.contractAddress;
  if (!value) {
    throw new Eip7702ExtensionBridgeError(
      "INVALID_AUTHORIZATION",
      "An EIP-7702 authorization request is missing its delegate address.",
    );
  }
  return getAddress(value);
}

function matchesAuthorizationRequest(
  left: AuthorizationRequest,
  right: AuthorizationRequest,
): boolean {
  return (
    left.chainId === right.chainId &&
    left.nonce === right.nonce &&
    sameAddress(requestAddress(left), requestAddress(right))
  );
}

function assertResultCommitments(
  signingPackage: Eip7702LocalSigningPackage,
  result: z.infer<typeof extensionSigningResultSchema>,
): void {
  if (
    result.packageId !== signingPackage.packageId ||
    result.chainId !== signingPackage.chainId ||
    !sameAddress(result.sourceAddress, signingPackage.sourceAddress) ||
    !sameAddress(result.destinationAddress, signingPackage.destinationAddress) ||
    result.planHash.toLowerCase() !== signingPackage.planHash.toLowerCase() ||
    result.expiresAt !== signingPackage.expiresAt
  ) {
    throw new Eip7702ExtensionBridgeError(
      "INVALID_AUTHORIZATION",
      "The extension result does not match the active rescue package.",
    );
  }
}

async function assertAuthorization(
  signed: SignedAuthorization,
  expected: AuthorizationRequest,
  sourceAddress: string,
): Promise<void> {
  if (
    signed.chainId !== expected.chainId ||
    signed.nonce !== expected.nonce ||
    !sameAddress(signed.address, requestAddress(expected))
  ) {
    throw new Eip7702ExtensionBridgeError(
      "INVALID_AUTHORIZATION",
      "The extension signed an authorization outside the committed scope.",
    );
  }
  const recovered = await recoverAuthorizationAddress({
    authorization: signed,
  });
  if (!sameAddress(recovered, sourceAddress)) {
    throw new Eip7702ExtensionBridgeError(
      "INVALID_AUTHORIZATION",
      "The extension authorization does not recover to the committed source.",
    );
  }
}

async function createOneUseSigner(
  signingPackage: Eip7702LocalSigningPackage,
  resultValue: unknown,
): Promise<Eip7702ExtensionAuthorizationSigner> {
  const result = extensionSigningResultSchema.parse(resultValue);
  assertResultCommitments(signingPackage, result);

  const pair = buildEip7702AuthorizationPair({
    chainId: signingPackage.chainId,
    delegateAddress: signingPackage.delegateAddress,
    sourceNonce: signingPackage.sourceNonce,
  });
  const delegation = result.delegationAuthorization as SignedAuthorization;
  const clearing = result.clearingAuthorization as SignedAuthorization;
  await Promise.all([
    assertAuthorization(delegation, pair.delegation, signingPackage.sourceAddress),
    assertAuthorization(clearing, pair.revocation, signingPackage.sourceAddress),
  ]);

  const signer = Object.freeze({
    async getAddress(): Promise<`0x${string}`> {
      return getAddress(signingPackage.sourceAddress);
    },
    async signAuthorization(
      request: AuthorizationRequest,
    ): Promise<SignedAuthorization> {
      const state = signerStates.get(signer);
      if (!state) {
        throw new Eip7702ExtensionBridgeError(
          "INVALID_AUTHORIZATION",
          "The extension authorizations were already consumed.",
        );
      }
      const expected = state.requests[state.index];
      if (!matchesAuthorizationRequest(request, expected)) {
        throw new Eip7702ExtensionBridgeError(
          "INVALID_AUTHORIZATION",
          "The runtime requested an authorization outside the extension package.",
        );
      }
      const signed = state.authorizations[state.index];
      if (state.index === 0) {
        state.index = 1;
      } else {
        signerStates.delete(signer);
      }
      return signed;
    },
  });
  signerStates.set(signer, {
    index: 0,
    requests: [pair.delegation, pair.revocation],
    authorizations: [delegation, clearing],
  });
  return signer;
}

export function createWindowSourceSignerTransport(
  targetWindow: Window = window,
): SourceSignerBridgeTransport {
  const origin = targetWindow.location.origin;
  return Object.freeze({
    origin,
    postMessage(message: unknown): void {
      targetWindow.postMessage(message, origin);
    },
    subscribe(
      listener: (message: SourceSignerBridgeMessage) => void,
    ): () => void {
      const handler = (event: MessageEvent<unknown>) => {
        listener({
          origin: event.origin,
          sourceIsSelf: event.source === targetWindow,
          data: event.data,
        });
      };
      targetWindow.addEventListener("message", handler);
      return () => targetWindow.removeEventListener("message", handler);
    },
  });
}

export async function detectEip7702SourceSignerExtension(input: {
  transport?: SourceSignerBridgeTransport;
  signal?: AbortSignal;
  timeoutMs?: number;
  createRequestId?: () => string;
} = {}): Promise<Eip7702SourceSignerAvailability> {
  const transport = input.transport ?? createWindowSourceSignerTransport();
  const requestId = requestIdSchema.parse(
    (input.createRequestId ?? (() => crypto.randomUUID()))(),
  );
  const timeoutMs = Math.max(1, Math.min(input.timeoutMs ?? 1_000, 5_000));

  return new Promise((resolve) => {
    let settled = false;
    let unsubscribe: () => void = () => undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let onAbort: () => void = () => undefined;

    const finish = (availability: Eip7702SourceSignerAvailability) => {
      if (settled) return;
      settled = true;
      unsubscribe();
      if (timeout) clearTimeout(timeout);
      input.signal?.removeEventListener("abort", onAbort);
      resolve(availability);
    };
    onAbort = () => finish({ status: "UNAVAILABLE" });

    unsubscribe = transport.subscribe((message) => {
      if (
        settled ||
        !message.sourceIsSelf ||
        message.origin !== transport.origin
      ) {
        return;
      }

      const envelope = extensionResponseEnvelopeSchema.safeParse(message.data);
      if (!envelope.success || envelope.data.requestId !== requestId) {
        return;
      }
      if (envelope.data.response.status === "ERROR") {
        finish({ status: "UNAVAILABLE" });
        return;
      }
      if (envelope.data.response.method !== "PING") {
        return;
      }

      finish({
        status: "AVAILABLE",
        extensionVersion: envelope.data.response.extensionVersion,
        supportedChainIds: envelope.data.response.supportedChainIds,
      });
    });

    timeout = setTimeout(
      () => finish({ status: "UNAVAILABLE" }),
      timeoutMs,
    );
    input.signal?.addEventListener("abort", onAbort, { once: true });
    if (input.signal?.aborted) {
      onAbort();
      return;
    }

    try {
      transport.postMessage({
        source: WEB_SOURCE,
        channel: CHANNEL,
        request: {
          requestId,
          method: "PING",
        },
      });
    } catch {
      finish({ status: "UNAVAILABLE" });
    }
  });
}

export async function requestEip7702SourceSignerFromExtension(input: {
  signingPackageValue: unknown;
  transport?: SourceSignerBridgeTransport;
  signal?: AbortSignal;
  timeoutMs?: number;
  now?: Date;
  createRequestId?: () => string;
}): Promise<Eip7702ExtensionAuthorizationSigner> {
  const parsedPackage = eip7702LocalSigningPackageSchema.safeParse(
    input.signingPackageValue,
  );
  if (!parsedPackage.success) {
    throw new Eip7702ExtensionBridgeError(
      "INVALID_PACKAGE",
      "SafeExit cannot send an invalid signing package to the extension.",
    );
  }
  const signingPackage = parsedPackage.data;
  const now = input.now ?? new Date();
  const remainingMs = Date.parse(signingPackage.expiresAt) - now.getTime();
  if (!Number.isFinite(remainingMs) || remainingMs <= 0) {
    throw new Eip7702ExtensionBridgeError(
      "PACKAGE_EXPIRED",
      "The EIP-7702 signing package has expired.",
    );
  }

  const transport = input.transport ?? createWindowSourceSignerTransport();
  const requestId = requestIdSchema.parse(
    (input.createRequestId ?? (() => crypto.randomUUID()))(),
  );
  const timeoutMs = Math.min(
    input.timeoutMs ?? remainingMs,
    remainingMs,
  );

  return new Promise((resolve, reject) => {
    let settled = false;
    let unsubscribe: () => void = () => undefined;
    const resources: {
      timeout?: ReturnType<typeof setTimeout>;
    } = {};

    const cleanup = () => {
      unsubscribe();
      if (resources.timeout) clearTimeout(resources.timeout);
      input.signal?.removeEventListener("abort", onAbort);
    };
    const fail = (error: Eip7702ExtensionBridgeError) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const onAbort = () => {
      fail(
        new Eip7702ExtensionBridgeError(
          "ABORTED",
          "The local source-signing request was cancelled.",
        ),
      );
    };

    unsubscribe = transport.subscribe((message) => {
      if (
        settled ||
        !message.sourceIsSelf ||
        message.origin !== transport.origin
      ) {
        return;
      }

      const response = extensionResponseEnvelopeSchema.safeParse(message.data);
      if (
        response.success &&
        response.data.requestId === requestId &&
        response.data.response.status === "ERROR"
      ) {
        fail(
          new Eip7702ExtensionBridgeError(
            "EXTENSION_REJECTED",
            response.data.response.message,
          ),
        );
        return;
      }

      const signedEvent = extensionSigningEventSchema.safeParse(message.data);
      if (!signedEvent.success || signedEvent.data.requestId !== requestId) {
        return;
      }
      void createOneUseSigner(signingPackage, signedEvent.data.result)
        .then((signer) => {
          if (settled) return;
          try {
            transport.postMessage({
              source: WEB_SOURCE,
              channel: CHANNEL,
              event: "EIP7702_AUTHORIZATIONS_ACCEPTED",
              requestId,
            });
          } catch {
            fail(
              new Eip7702ExtensionBridgeError(
                "SIGNER_UNAVAILABLE",
                "SafeExit verified the authorization but could not acknowledge it to the source signer.",
              ),
            );
            return;
          }
          settled = true;
          cleanup();
          resolve(signer);
        })
        .catch(() => {
          fail(
            new Eip7702ExtensionBridgeError(
              "INVALID_AUTHORIZATION",
              "The extension returned invalid EIP-7702 authorizations.",
            ),
          );
        });
    });

    resources.timeout = setTimeout(() => {
      fail(
        new Eip7702ExtensionBridgeError(
          "SIGNER_UNAVAILABLE",
          "The SafeExit Source Signer did not return authorizations before the package expired.",
        ),
      );
    }, timeoutMs);
    input.signal?.addEventListener("abort", onAbort, { once: true });
    if (input.signal?.aborted) {
      onAbort();
      return;
    }

    try {
      transport.postMessage({
        source: WEB_SOURCE,
        channel: CHANNEL,
        request: {
          requestId,
          method: "REVIEW_EIP7702_PACKAGE",
          signingPackage,
        },
      });
    } catch {
      fail(
        new Eip7702ExtensionBridgeError(
          "SIGNER_UNAVAILABLE",
          "The SafeExit Source Signer request could not be delivered.",
        ),
      );
    }
  });
}
