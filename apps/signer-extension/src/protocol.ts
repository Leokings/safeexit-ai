import {
  EIP7702_ACTION_KIND,
  buildEip7702AuthorizationPair,
} from "@safeexit/adapters/eip7702-rescue";
import {
  eip7702LocalSigningPackageSchema,
  type Eip7702LocalSigningPackage,
} from "@safeexit/agent-service/eip7702-signing-package";
import { XLAYER_SAFEEXIT_EIP7702_FACTORY_V2 } from "@safeexit/buyer-runtime/eip7702-trust";
import {
  getAddress,
  type AuthorizationRequest,
  type SignedAuthorization,
} from "viem";
import { recoverAuthorizationAddress } from "viem/utils";
import { z } from "zod";

export const SAFEEXIT_SIGNER_CHANNEL = "safeexit-source-signer-v1" as const;
export const SAFEEXIT_WEB_SOURCE = "safeexit-web" as const;
export const SAFEEXIT_EXTENSION_SOURCE = "safeexit-source-signer" as const;

export const SAFEEXIT_SIGNER_ALLOWED_ORIGINS = Object.freeze([
  "https://safeexit.xyz",
  "http://127.0.0.1:3000",
  "http://localhost:3000",
  "http://127.0.0.1:4179",
  "http://localhost:4179",
] as const);

const requestIdSchema = z
  .string()
  .min(8)
  .max(128)
  .regex(/^[a-zA-Z0-9:_-]+$/);

const pingRequestSchema = z.strictObject({
  requestId: requestIdSchema,
  method: z.literal("PING"),
});

const reviewRequestSchema = z.strictObject({
  requestId: requestIdSchema,
  method: z.literal("REVIEW_EIP7702_PACKAGE"),
  signingPackage: eip7702LocalSigningPackageSchema,
});

export const safeExitSignerRequestSchema = z.discriminatedUnion("method", [
  pingRequestSchema,
  reviewRequestSchema,
]);

export const safeExitPageEnvelopeSchema = z.strictObject({
  source: z.literal(SAFEEXIT_WEB_SOURCE),
  channel: z.literal(SAFEEXIT_SIGNER_CHANNEL),
  request: safeExitSignerRequestSchema,
});

export const safeExitSigningAcceptanceEnvelopeSchema = z.strictObject({
  source: z.literal(SAFEEXIT_WEB_SOURCE),
  channel: z.literal(SAFEEXIT_SIGNER_CHANNEL),
  event: z.literal("EIP7702_AUTHORIZATIONS_ACCEPTED"),
  requestId: requestIdSchema,
});

const authorizationReviewSchema = z.strictObject({
  chainId: z.literal(196),
  address: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  nonce: z.number().int().nonnegative().safe(),
});

const actionReviewSchema = z.strictObject({
  index: z.number().int().nonnegative(),
  actionId: z.string().min(1).max(256),
  label: z.string().min(1).max(80),
  asset: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  counterparty: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  tokenId: z.string().regex(/^(0|[1-9]\d*)$/),
  amount: z.string().regex(/^(0|[1-9]\d*)$/),
});

export const eip7702ExtensionReviewSchema = z.strictObject({
  schemaVersion: z.literal("safeexit-extension-review-v1"),
  packageId: z.string().min(1).max(256),
  networkName: z.literal("X Layer"),
  chainId: z.literal(196),
  sourceAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  destinationAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  factoryAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  delegateAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  planHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
  expiresAt: z.string().datetime({ offset: true }),
  actions: z.array(actionReviewSchema).min(1).max(256),
  delegationAuthorization: authorizationReviewSchema,
  clearingAuthorization: authorizationReviewSchema,
  destinationConnectsToExtension: z.literal(false),
  privateCredentialsAccepted: z.literal(false),
});

export const signedAuthorizationSchema = z.strictObject({
  address: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  chainId: z.literal(196),
  nonce: z.number().int().nonnegative().safe(),
  yParity: z.union([z.literal(0), z.literal(1)]),
  r: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
  s: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
});

export const signedAuthorizationPairSchema = z.strictObject({
  delegation: signedAuthorizationSchema,
  clearing: signedAuthorizationSchema,
});

export const eip7702ExtensionSigningResultSchema = z.strictObject({
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

const statusResponseSchema = z.strictObject({
  status: z.literal("OK"),
  method: z.literal("PING"),
  extensionVersion: z.string().min(1).max(32),
  signerState: z.literal("READY_FOR_EPHEMERAL_KEY"),
  supportedChainIds: z.tuple([z.literal(196)]),
  privateCredentialsAccepted: z.literal(false),
  extensionOnlyEphemeralKeyAccepted: z.literal(true),
  destinationConnectsToExtension: z.literal(false),
});

const reviewResponseSchema = z.strictObject({
  status: z.literal("OK"),
  method: z.literal("REVIEW_EIP7702_PACKAGE"),
  signerState: z.literal("READY_FOR_EPHEMERAL_KEY"),
  review: eip7702ExtensionReviewSchema,
});

const errorResponseSchema = z.strictObject({
  status: z.literal("ERROR"),
  code: z.union([
    z.literal("UNTRUSTED_ORIGIN"),
    z.literal("INVALID_REQUEST"),
    z.literal("PACKAGE_EXPIRED"),
    z.literal("UNTRUSTED_FACTORY"),
    z.literal("SIGNER_NOT_CONFIGURED"),
  ]),
  message: z.string().min(1).max(500),
});

export const safeExitSignerResponseSchema = z.union([
  statusResponseSchema,
  reviewResponseSchema,
  errorResponseSchema,
]);

export const safeExitExtensionEnvelopeSchema = z.strictObject({
  source: z.literal(SAFEEXIT_EXTENSION_SOURCE),
  channel: z.literal(SAFEEXIT_SIGNER_CHANNEL),
  requestId: requestIdSchema,
  response: safeExitSignerResponseSchema,
});

export type SafeExitSignerRequest = z.infer<typeof safeExitSignerRequestSchema>;
export type SafeExitSignerResponse = z.infer<typeof safeExitSignerResponseSchema>;
export type Eip7702ExtensionReview = z.infer<
  typeof eip7702ExtensionReviewSchema
>;
export type SignedAuthorizationPair = z.infer<
  typeof signedAuthorizationPairSchema
>;
export type Eip7702ExtensionSigningResult = z.infer<
  typeof eip7702ExtensionSigningResultSchema
>;

function sameAddress(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function authorizationAddress(request: AuthorizationRequest): `0x${string}` {
  const address = "address" in request
    ? request.address
    : request.contractAddress;
  if (!address) {
    throw new Error("Authorization request is missing its delegate address");
  }
  return getAddress(address);
}

function actionLabel(kind: number): string {
  switch (kind) {
    case EIP7702_ACTION_KIND.TRANSFER_NATIVE:
      return "Transfer native balance";
    case EIP7702_ACTION_KIND.TRANSFER_ERC20:
      return "Transfer ERC-20";
    case EIP7702_ACTION_KIND.TRANSFER_ERC721:
      return "Transfer ERC-721";
    case EIP7702_ACTION_KIND.TRANSFER_ERC1155:
      return "Transfer ERC-1155";
    case EIP7702_ACTION_KIND.REVOKE_ERC20_APPROVAL:
      return "Revoke ERC-20 approval";
    case EIP7702_ACTION_KIND.REVOKE_NFT_OPERATOR:
      return "Revoke NFT operator";
    default:
      throw new Error("Unsupported EIP-7702 action kind");
  }
}

export function isSafeExitSignerOrigin(origin: string): boolean {
  return (SAFEEXIT_SIGNER_ALLOWED_ORIGINS as readonly string[]).includes(origin);
}

function packageError(
  code: "PACKAGE_EXPIRED" | "UNTRUSTED_FACTORY",
  message: string,
): SafeExitSignerResponse {
  return { status: "ERROR", code, message };
}

function matchesAuthorization(
  signed: SignedAuthorization,
  expected: Eip7702ExtensionReview["delegationAuthorization"],
): boolean {
  return (
    sameAddress(signed.address, expected.address) &&
    signed.chainId === expected.chainId &&
    signed.nonce === expected.nonce
  );
}

export async function createEip7702ExtensionSigningResult(input: {
  reviewValue: unknown;
  authorizationsValue: unknown;
  now?: Date;
}): Promise<Eip7702ExtensionSigningResult> {
  const review = eip7702ExtensionReviewSchema.parse(input.reviewValue);
  const authorizations = signedAuthorizationPairSchema.parse(
    input.authorizationsValue,
  );
  const now = input.now ?? new Date();
  if (Date.parse(review.expiresAt) <= now.getTime()) {
    throw new Error("The staged EIP-7702 package has expired.");
  }
  if (
    !matchesAuthorization(
      authorizations.delegation as SignedAuthorization,
      review.delegationAuthorization,
    ) ||
    !matchesAuthorization(
      authorizations.clearing as SignedAuthorization,
      review.clearingAuthorization,
    )
  ) {
    throw new Error(
      "The signed EIP-7702 authorizations do not match the staged review.",
    );
  }

  const [delegationSource, clearingSource] = await Promise.all([
    recoverAuthorizationAddress({
      authorization: authorizations.delegation as SignedAuthorization,
    }),
    recoverAuthorizationAddress({
      authorization: authorizations.clearing as SignedAuthorization,
    }),
  ]);
  if (
    !sameAddress(delegationSource, review.sourceAddress) ||
    !sameAddress(clearingSource, review.sourceAddress)
  ) {
    throw new Error(
      "The signed EIP-7702 authorizations do not recover to the staged source.",
    );
  }

  return eip7702ExtensionSigningResultSchema.parse({
    schemaVersion: "safeexit-extension-authorizations-v1",
    packageId: review.packageId,
    chainId: review.chainId,
    sourceAddress: review.sourceAddress,
    destinationAddress: review.destinationAddress,
    planHash: review.planHash,
    expiresAt: review.expiresAt,
    delegationAuthorization: authorizations.delegation,
    clearingAuthorization: authorizations.clearing,
    destinationPaysGas: true,
    privateCredentialsIncluded: false,
  });
}

function assertPackageFresh(
  signingPackage: Eip7702LocalSigningPackage,
  now: Date,
): SafeExitSignerResponse | undefined {
  const expiresAt = Date.parse(signingPackage.expiresAt);
  if (
    !Number.isFinite(expiresAt) ||
    expiresAt <= now.getTime() ||
    expiresAt - now.getTime() > 15 * 60 * 1_000
  ) {
    return packageError(
      "PACKAGE_EXPIRED",
      "The rescue package is expired or exceeds the fifteen-minute signing window.",
    );
  }
  return undefined;
}

function assertPinnedFactory(
  signingPackage: Eip7702LocalSigningPackage,
): SafeExitSignerResponse | undefined {
  if (
    signingPackage.chainId !== XLAYER_SAFEEXIT_EIP7702_FACTORY_V2.chainId ||
    !sameAddress(
      signingPackage.factoryAddress,
      XLAYER_SAFEEXIT_EIP7702_FACTORY_V2.address,
    ) ||
    signingPackage.factoryRuntimeHash.toLowerCase() !==
      XLAYER_SAFEEXIT_EIP7702_FACTORY_V2.runtimeHash.toLowerCase()
  ) {
    return packageError(
      "UNTRUSTED_FACTORY",
      "The package does not use the extension's pinned X Layer SafeExit factory.",
    );
  }
  return undefined;
}

export function createEip7702ExtensionReview(
  packageValue: unknown,
  now: Date = new Date(),
): Eip7702ExtensionReview | SafeExitSignerResponse {
  const parsed = eip7702LocalSigningPackageSchema.safeParse(packageValue);
  if (!parsed.success) {
    return {
      status: "ERROR",
      code: "INVALID_REQUEST",
      message: "The website supplied an invalid EIP-7702 signing package.",
    };
  }

  const signingPackage = parsed.data;
  const freshnessFailure = assertPackageFresh(signingPackage, now);
  if (freshnessFailure) return freshnessFailure;
  const factoryFailure = assertPinnedFactory(signingPackage);
  if (factoryFailure) return factoryFailure;

  const authorizationPair = buildEip7702AuthorizationPair({
    chainId: signingPackage.chainId,
    delegateAddress: signingPackage.delegateAddress,
    sourceNonce: signingPackage.sourceNonce,
  });

  return eip7702ExtensionReviewSchema.parse({
    schemaVersion: "safeexit-extension-review-v1",
    packageId: signingPackage.packageId,
    networkName: "X Layer",
    chainId: signingPackage.chainId,
    sourceAddress: getAddress(signingPackage.sourceAddress),
    destinationAddress: getAddress(signingPackage.destinationAddress),
    factoryAddress: getAddress(signingPackage.factoryAddress),
    delegateAddress: getAddress(signingPackage.delegateAddress),
    planHash: signingPackage.planHash,
    expiresAt: signingPackage.expiresAt,
    actions: signingPackage.actions.map((action, index) => ({
      index,
      actionId: signingPackage.actionIds[index]!,
      label: actionLabel(action.kind),
      asset: getAddress(action.asset),
      counterparty: getAddress(action.counterparty),
      tokenId: action.tokenId,
      amount: action.amount,
    })),
    delegationAuthorization: {
      chainId: signingPackage.chainId,
      address: authorizationAddress(authorizationPair.delegation),
      nonce: Number(authorizationPair.delegation.nonce),
    },
    clearingAuthorization: {
      chainId: signingPackage.chainId,
      address: authorizationAddress(authorizationPair.revocation),
      nonce: Number(authorizationPair.revocation.nonce),
    },
    destinationConnectsToExtension: false,
    privateCredentialsAccepted: false,
  });
}

export function handleSafeExitSignerRequest(input: {
  origin: string;
  requestValue: unknown;
  extensionVersion: string;
  now?: Date;
}): SafeExitSignerResponse {
  if (!isSafeExitSignerOrigin(input.origin)) {
    return {
      status: "ERROR",
      code: "UNTRUSTED_ORIGIN",
      message: "SafeExit Source Signer does not trust this website origin.",
    };
  }

  const parsed = safeExitSignerRequestSchema.safeParse(input.requestValue);
  if (!parsed.success) {
    return {
      status: "ERROR",
      code: "INVALID_REQUEST",
      message: "The website sent an invalid source-signer request.",
    };
  }

  if (parsed.data.method === "PING") {
    return statusResponseSchema.parse({
      status: "OK",
      method: "PING",
      extensionVersion: input.extensionVersion,
      signerState: "READY_FOR_EPHEMERAL_KEY",
      supportedChainIds: [196],
      privateCredentialsAccepted: false,
      extensionOnlyEphemeralKeyAccepted: true,
      destinationConnectsToExtension: false,
    });
  }

  const review = createEip7702ExtensionReview(
    parsed.data.signingPackage,
    input.now,
  );
  if ("status" in review) return review;

  return reviewResponseSchema.parse({
    status: "OK",
    method: "REVIEW_EIP7702_PACKAGE",
    signerState: "READY_FOR_EPHEMERAL_KEY",
    review,
  });
}

export function extensionEnvelope(
  requestId: string,
  response: SafeExitSignerResponse,
) {
  return safeExitExtensionEnvelopeSchema.parse({
    source: SAFEEXIT_EXTENSION_SOURCE,
    channel: SAFEEXIT_SIGNER_CHANNEL,
    requestId,
    response,
  });
}
