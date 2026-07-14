import { z } from "zod";

import {
  getConfiguredPermitSettlementAddress,
  PERMIT_KIND_DAI,
  PERMIT_KIND_ERC2612,
  PERMIT_SETTLEMENT_NAME,
  PERMIT_SETTLEMENT_VERSION,
} from "@safeexit/adapters";
import { chainIdSchema, evmAddressSchema } from "@safeexit/shared";

const identifierSchema = z.string().min(1).max(256);
const timestampSchema = z.string().datetime({ offset: true });
const blockNumberSchema = z.string().regex(/^(0|[1-9]\d*)$/);
const baseUnitAmountSchema = z.string().regex(/^(0|[1-9]\d*)$/);
const positiveBaseUnitAmountSchema = baseUnitAmountSchema.refine(
  (value) => BigInt(value) > 0n,
  "Amount must be greater than zero",
);
const hashSchema = z.string().regex(/^0x[a-fA-F0-9]{64}$/);
const bytes32Schema = hashSchema;

export const recoveryExecutionPathSchema = z.enum([
  "DIRECT_AUTHORIZATION",
  "SAFEEXIT_SETTLEMENT",
]);
export const authorizationStandardSchema = z.enum([
  "ERC3009",
  "ERC2612",
  "DAI_PERMIT",
  "ERC4494",
]);

const typedDataField = <TName extends string, TType extends string>(
  name: TName,
  type: TType,
) => z.strictObject({ name: z.literal(name), type: z.literal(type) });

export const SIGNING_PACKAGE_EIP712_TYPES = {
  EIP712Domain: [
    { name: "name", type: "string" },
    { name: "version", type: "string" },
    { name: "chainId", type: "uint256" },
    { name: "verifyingContract", type: "address" },
  ],
  ReceiveWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
  ERC2612Permit: [
    { name: "owner", type: "address" },
    { name: "spender", type: "address" },
    { name: "value", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
  DaiPermit: [
    { name: "holder", type: "address" },
    { name: "spender", type: "address" },
    { name: "nonce", type: "uint256" },
    { name: "expiry", type: "uint256" },
    { name: "allowed", type: "bool" },
  ],
  ERC4494Permit: [
    { name: "spender", type: "address" },
    { name: "tokenId", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
  ERC20Rescue: [
    { name: "token", type: "address" },
    { name: "owner", type: "address" },
    { name: "destination", type: "address" },
    { name: "amount", type: "uint256" },
    { name: "permitNonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
    { name: "rescueNonce", type: "bytes32" },
    { name: "permitKind", type: "uint8" },
  ],
  ERC721Rescue: [
    { name: "collection", type: "address" },
    { name: "owner", type: "address" },
    { name: "destination", type: "address" },
    { name: "tokenId", type: "uint256" },
    { name: "permitNonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
    { name: "rescueNonce", type: "bytes32" },
  ],
} as const;

const domainTypeSchema = z.tuple([
  typedDataField("name", "string"),
  typedDataField("version", "string"),
  typedDataField("chainId", "uint256"),
  typedDataField("verifyingContract", "address"),
]);

export const signingDomainSchema = z.strictObject({
  name: z.string().min(1).max(128),
  version: z.string().min(1).max(32),
  chainId: chainIdSchema,
  verifyingContract: evmAddressSchema,
});

const packagePolicySchema = z.strictObject({
  sourceSignsLocally: z.literal(true),
  destinationPaysSettlement: z.literal(true),
  privateCredentialsAccepted: z.literal(false),
  signaturesReturnedToSafeExit: z.literal(false),
  arbitraryCallsAllowed: z.literal(false),
  postSignatureSimulationRequired: z.literal(true),
});

const simulationCommitmentSchema = z.strictObject({
  resultId: identifierSchema,
  providerId: z.string().min(1).max(128),
  status: z.literal("SUCCEEDED"),
  expiresAt: timestampSchema,
});

const signingRequestCommonShape = {
  id: identifierSchema,
  signer: evmAddressSchema,
  method: z.literal("EIP712"),
  rpcMethod: z.literal("eth_signTypedData_v4"),
} satisfies z.ZodRawShape;

const packageCommonShape = {
  schemaVersion: z.literal("safeexit-signing-package-v1"),
  packageId: identifierSchema,
  jobId: identifierSchema,
  incidentId: identifierSchema,
  planId: identifierSchema,
  planHash: hashSchema,
  actionId: identifierSchema,
  chainId: chainIdSchema,
  sourceAddress: evmAddressSchema,
  destinationAddress: evmAddressSchema,
  observedAtBlock: blockNumberSchema,
  expiresAt: timestampSchema,
  simulation: simulationCommitmentSchema,
  policy: packagePolicySchema,
} satisfies z.ZodRawShape;

const eip3009SigningRequestSchema = z.strictObject({
  ...signingRequestCommonShape,
  id: z.literal("source-transfer-authorization"),
  typedData: z.strictObject({
    primaryType: z.literal("ReceiveWithAuthorization"),
    types: z.strictObject({
      EIP712Domain: domainTypeSchema,
      ReceiveWithAuthorization: z.tuple([
        typedDataField("from", "address"),
        typedDataField("to", "address"),
        typedDataField("value", "uint256"),
        typedDataField("validAfter", "uint256"),
        typedDataField("validBefore", "uint256"),
        typedDataField("nonce", "bytes32"),
      ]),
    }),
    domain: signingDomainSchema,
    message: z.strictObject({
      from: evmAddressSchema,
      to: evmAddressSchema,
      value: positiveBaseUnitAmountSchema,
      validAfter: baseUnitAmountSchema,
      validBefore: baseUnitAmountSchema,
      nonce: bytes32Schema,
    }),
  }),
});

const erc2612SigningRequestSchema = z.strictObject({
  ...signingRequestCommonShape,
  id: z.literal("source-permit"),
  typedData: z.strictObject({
    primaryType: z.literal("Permit"),
    types: z.strictObject({
      EIP712Domain: domainTypeSchema,
      Permit: z.tuple([
        typedDataField("owner", "address"),
        typedDataField("spender", "address"),
        typedDataField("value", "uint256"),
        typedDataField("nonce", "uint256"),
        typedDataField("deadline", "uint256"),
      ]),
    }),
    domain: signingDomainSchema,
    message: z.strictObject({
      owner: evmAddressSchema,
      spender: evmAddressSchema,
      value: positiveBaseUnitAmountSchema,
      nonce: baseUnitAmountSchema,
      deadline: baseUnitAmountSchema,
    }),
  }),
});

const daiSigningRequestSchema = z.strictObject({
  ...signingRequestCommonShape,
  id: z.enum(["source-allow-permit", "source-revoke-permit"]),
  typedData: z.strictObject({
    primaryType: z.literal("Permit"),
    types: z.strictObject({
      EIP712Domain: domainTypeSchema,
      Permit: z.tuple([
        typedDataField("holder", "address"),
        typedDataField("spender", "address"),
        typedDataField("nonce", "uint256"),
        typedDataField("expiry", "uint256"),
        typedDataField("allowed", "bool"),
      ]),
    }),
    domain: signingDomainSchema,
    message: z.strictObject({
      holder: evmAddressSchema,
      spender: evmAddressSchema,
      nonce: baseUnitAmountSchema,
      expiry: baseUnitAmountSchema,
      allowed: z.boolean(),
    }),
  }),
});

const erc4494SigningRequestSchema = z.strictObject({
  ...signingRequestCommonShape,
  id: z.literal("source-nft-permit"),
  typedData: z.strictObject({
    primaryType: z.literal("Permit"),
    types: z.strictObject({
      EIP712Domain: domainTypeSchema,
      Permit: z.tuple([
        typedDataField("spender", "address"),
        typedDataField("tokenId", "uint256"),
        typedDataField("nonce", "uint256"),
        typedDataField("deadline", "uint256"),
      ]),
    }),
    domain: signingDomainSchema,
    message: z.strictObject({
      spender: evmAddressSchema,
      tokenId: baseUnitAmountSchema,
      nonce: baseUnitAmountSchema,
      deadline: baseUnitAmountSchema,
    }),
  }),
});

const erc20RescueSigningRequestSchema = z.strictObject({
  ...signingRequestCommonShape,
  id: z.literal("source-rescue-authorization"),
  typedData: z.strictObject({
    primaryType: z.literal("ERC20Rescue"),
    types: z.strictObject({
      EIP712Domain: domainTypeSchema,
      ERC20Rescue: z.tuple([
        typedDataField("token", "address"),
        typedDataField("owner", "address"),
        typedDataField("destination", "address"),
        typedDataField("amount", "uint256"),
        typedDataField("permitNonce", "uint256"),
        typedDataField("deadline", "uint256"),
        typedDataField("rescueNonce", "bytes32"),
        typedDataField("permitKind", "uint8"),
      ]),
    }),
    domain: signingDomainSchema,
    message: z.strictObject({
      token: evmAddressSchema,
      owner: evmAddressSchema,
      destination: evmAddressSchema,
      amount: positiveBaseUnitAmountSchema,
      permitNonce: baseUnitAmountSchema,
      deadline: baseUnitAmountSchema,
      rescueNonce: bytes32Schema.refine((value) => !/^0x0{64}$/i.test(value)),
      permitKind: z.union([z.literal(1), z.literal(2)]),
    }),
  }),
});

const erc721RescueSigningRequestSchema = z.strictObject({
  ...signingRequestCommonShape,
  id: z.literal("source-rescue-authorization"),
  typedData: z.strictObject({
    primaryType: z.literal("ERC721Rescue"),
    types: z.strictObject({
      EIP712Domain: domainTypeSchema,
      ERC721Rescue: z.tuple([
        typedDataField("collection", "address"),
        typedDataField("owner", "address"),
        typedDataField("destination", "address"),
        typedDataField("tokenId", "uint256"),
        typedDataField("permitNonce", "uint256"),
        typedDataField("deadline", "uint256"),
        typedDataField("rescueNonce", "bytes32"),
      ]),
    }),
    domain: signingDomainSchema,
    message: z.strictObject({
      collection: evmAddressSchema,
      owner: evmAddressSchema,
      destination: evmAddressSchema,
      tokenId: baseUnitAmountSchema,
      permitNonce: baseUnitAmountSchema,
      deadline: baseUnitAmountSchema,
      rescueNonce: bytes32Schema.refine((value) => !/^0x0{64}$/i.test(value)),
    }),
  }),
});

const settlementCommonShape = {
  executor: evmAddressSchema,
  payer: z.literal("DESTINATION"),
  assembly: z.literal("BUYER_LOCAL_RUNTIME"),
} satisfies z.ZodRawShape;

const eip3009PackageSchema = z.strictObject({
  ...packageCommonShape,
  route: z.literal("ERC3009_RECEIVE_WITH_AUTHORIZATION"),
  tokenAddress: evmAddressSchema,
  amount: positiveBaseUnitAmountSchema,
  sourceSigningRequests: z.tuple([eip3009SigningRequestSchema]),
  destinationSettlement: z.strictObject({
    ...settlementCommonShape,
    atomicRequired: z.literal(false),
    operations: z.tuple([z.literal("RECEIVE_WITH_AUTHORIZATION")]),
  }),
});

const erc2612PackageSchema = z.strictObject({
  ...packageCommonShape,
  route: z.literal("ERC2612_PERMIT_SETTLEMENT"),
  tokenAddress: evmAddressSchema,
  settlementContract: evmAddressSchema,
  amount: positiveBaseUnitAmountSchema,
  sourceSigningRequests: z.tuple([
    erc2612SigningRequestSchema,
    erc20RescueSigningRequestSchema,
  ]),
  destinationSettlement: z.strictObject({
    ...settlementCommonShape,
    atomicRequired: z.literal(false),
    operations: z.tuple([z.literal("SETTLE_ERC2612")]),
  }),
});

const daiPermitPackageSchema = z.strictObject({
  ...packageCommonShape,
  route: z.literal("DAI_PERMIT_SETTLEMENT"),
  tokenAddress: evmAddressSchema,
  settlementContract: evmAddressSchema,
  amount: positiveBaseUnitAmountSchema,
  sourceSigningRequests: z.tuple([
    daiSigningRequestSchema,
    daiSigningRequestSchema,
    erc20RescueSigningRequestSchema,
  ]),
  destinationSettlement: z.strictObject({
    ...settlementCommonShape,
    atomicRequired: z.literal(false),
    operations: z.tuple([z.literal("SETTLE_DAI_PERMIT")]),
  }),
});

const erc4494PackageSchema = z.strictObject({
  ...packageCommonShape,
  route: z.literal("ERC4494_PERMIT_SETTLEMENT"),
  collectionAddress: evmAddressSchema,
  settlementContract: evmAddressSchema,
  tokenId: baseUnitAmountSchema,
  sourceSigningRequests: z.tuple([
    erc4494SigningRequestSchema,
    erc721RescueSigningRequestSchema,
  ]),
  destinationSettlement: z.strictObject({
    ...settlementCommonShape,
    atomicRequired: z.literal(false),
    operations: z.tuple([z.literal("SETTLE_ERC4494")]),
  }),
});

export const signingPackageSchema = z
  .discriminatedUnion("route", [
    eip3009PackageSchema,
    erc2612PackageSchema,
    daiPermitPackageSchema,
    erc4494PackageSchema,
  ])
  .superRefine((value, context) => {
    const sameAddress = (left: string, right: string) =>
      left.toLowerCase() === right.toLowerCase();
    const expiry = String(Math.floor(Date.parse(value.expiresAt) / 1_000));
    if (Date.parse(value.simulation.expiresAt) <= Date.parse(value.expiresAt)) {
      context.addIssue({
        code: "custom",
        message: "Committed simulation must outlive the signing package",
        path: ["simulation", "expiresAt"],
      });
    }
    if (value.sourceAddress.toLowerCase() === value.destinationAddress.toLowerCase()) {
      context.addIssue({
        code: "custom",
        message: "Signing-package source and destination must be different",
        path: ["destinationAddress"],
      });
    }
    if (value.destinationSettlement.executor.toLowerCase() !== value.destinationAddress.toLowerCase()) {
      context.addIssue({
        code: "custom",
        message: "Settlement executor must be the confirmed destination",
        path: ["destinationSettlement", "executor"],
      });
    }
    value.sourceSigningRequests.forEach((request, index) => {
      if (request.signer.toLowerCase() !== value.sourceAddress.toLowerCase()) {
        context.addIssue({
          code: "custom",
          message: "Every signing request must be scoped to the source wallet",
          path: ["sourceSigningRequests", index, "signer"],
        });
      }
      if (request.typedData.domain.chainId !== value.chainId) {
        context.addIssue({
          code: "custom",
          message: "Signing domain chain must match the rescue plan",
          path: ["sourceSigningRequests", index, "typedData", "domain", "chainId"],
        });
      }
    });
    if (value.route === "ERC3009_RECEIVE_WITH_AUTHORIZATION") {
      const request = value.sourceSigningRequests[0];
      if (!sameAddress(request.typedData.domain.verifyingContract, value.tokenAddress)) {
        context.addIssue({
          code: "custom",
          message: "Signing domain contract must match the committed asset contract",
          path: ["sourceSigningRequests", 0, "typedData", "domain", "verifyingContract"],
        });
      }
      const message = value.sourceSigningRequests[0].typedData.message;
      const validAfter = BigInt(message.validAfter);
      const validBefore = BigInt(message.validBefore);
      if (
        !sameAddress(message.from, value.sourceAddress) ||
        !sameAddress(message.to, value.destinationAddress) ||
        message.value !== value.amount ||
        message.validBefore !== expiry ||
        validAfter >= validBefore ||
        validBefore - validAfter > 600n ||
        /^0x0{64}$/i.test(message.nonce)
      ) {
        context.addIssue({
          code: "custom",
          message: "ERC-3009 authorization must match the committed transfer scope",
          path: ["sourceSigningRequests", 0, "typedData", "message"],
        });
      }
      return;
    }
    const configuredSettlement = getConfiguredPermitSettlementAddress(value.chainId);
    if (
      !configuredSettlement ||
      !sameAddress(configuredSettlement, value.settlementContract)
    ) {
      context.addIssue({
        code: "custom",
        message: "Permit settlement contract is not configured for this chain",
        path: ["settlementContract"],
      });
    }
    const rescueRequest = value.sourceSigningRequests.at(-1)!;
    const assetContract = value.route === "ERC4494_PERMIT_SETTLEMENT"
      ? value.collectionAddress
      : value.tokenAddress;
    value.sourceSigningRequests.forEach((request, index) => {
      const expectedContract = request.id === "source-rescue-authorization"
        ? value.settlementContract
        : assetContract;
      if (!sameAddress(request.typedData.domain.verifyingContract, expectedContract)) {
        context.addIssue({
          code: "custom",
          message: "Signing domain contract does not match its committed contract",
          path: ["sourceSigningRequests", index, "typedData", "domain", "verifyingContract"],
        });
      }
    });
    if (
      rescueRequest.typedData.domain.name !== PERMIT_SETTLEMENT_NAME ||
      rescueRequest.typedData.domain.version !== PERMIT_SETTLEMENT_VERSION
    ) {
      context.addIssue({
        code: "custom",
        message: "Rescue authorization domain does not match SafeExit settlement",
        path: ["sourceSigningRequests", value.sourceSigningRequests.length - 1, "typedData", "domain"],
      });
    }
    if (value.route === "ERC2612_PERMIT_SETTLEMENT") {
      const message = value.sourceSigningRequests[0].typedData.message;
      const rescue = value.sourceSigningRequests[1].typedData.message;
      if (
        !sameAddress(message.owner, value.sourceAddress) ||
        !sameAddress(message.spender, value.settlementContract) ||
        message.value !== value.amount ||
        message.deadline !== expiry
      ) {
        context.addIssue({
          code: "custom",
          message: "ERC-2612 permit must match the committed transfer scope",
          path: ["sourceSigningRequests", 0, "typedData", "message"],
        });
      }
      if (
        !sameAddress(rescue.token, value.tokenAddress) ||
        !sameAddress(rescue.owner, value.sourceAddress) ||
        !sameAddress(rescue.destination, value.destinationAddress) ||
        rescue.amount !== value.amount ||
        rescue.permitNonce !== message.nonce ||
        rescue.deadline !== expiry ||
        rescue.permitKind !== PERMIT_KIND_ERC2612
      ) {
        context.addIssue({
          code: "custom",
          message: "ERC-2612 rescue authorization must bind the complete settlement scope",
          path: ["sourceSigningRequests", 1, "typedData", "message"],
        });
      }
    }
    if (value.route === "DAI_PERMIT_SETTLEMENT") {
      const [allow, revoke, rescueRequestValue] = value.sourceSigningRequests;
      if (!allow.typedData.message.allowed || revoke.typedData.message.allowed) {
        context.addIssue({
          code: "custom",
          message: "DAI-style package must sign allow before revoke",
          path: ["sourceSigningRequests"],
        });
      }
      if (BigInt(revoke.typedData.message.nonce) !== BigInt(allow.typedData.message.nonce) + 1n) {
        context.addIssue({
          code: "custom",
          message: "DAI-style revoke nonce must immediately follow the allow nonce",
          path: ["sourceSigningRequests", 1, "typedData", "message", "nonce"],
        });
      }
      for (const [index, request] of [allow, revoke].entries()) {
        const message = request.typedData.message;
        if (
          !sameAddress(message.holder, value.sourceAddress) ||
          !sameAddress(message.spender, value.settlementContract) ||
          message.expiry !== expiry
        ) {
          context.addIssue({
            code: "custom",
            message: "DAI-style permit must match the committed transfer scope",
            path: ["sourceSigningRequests", index, "typedData", "message"],
          });
        }
      }
      const rescue = rescueRequestValue.typedData.message;
      if (
        !sameAddress(rescue.token, value.tokenAddress) ||
        !sameAddress(rescue.owner, value.sourceAddress) ||
        !sameAddress(rescue.destination, value.destinationAddress) ||
        rescue.amount !== value.amount ||
        rescue.permitNonce !== allow.typedData.message.nonce ||
        rescue.deadline !== expiry ||
        rescue.permitKind !== PERMIT_KIND_DAI
      ) {
        context.addIssue({
          code: "custom",
          message: "DAI-style rescue authorization must bind the complete settlement scope",
          path: ["sourceSigningRequests", 2, "typedData", "message"],
        });
      }
    }
    if (value.route === "ERC4494_PERMIT_SETTLEMENT") {
      const message = value.sourceSigningRequests[0].typedData.message;
      const rescue = value.sourceSigningRequests[1].typedData.message;
      if (
        !sameAddress(message.spender, value.settlementContract) ||
        message.tokenId !== value.tokenId ||
        message.deadline !== expiry
      ) {
        context.addIssue({
          code: "custom",
          message: "ERC-4494 permit must match the committed NFT transfer scope",
          path: ["sourceSigningRequests", 0, "typedData", "message"],
        });
      }
      if (
        !sameAddress(rescue.collection, value.collectionAddress) ||
        !sameAddress(rescue.owner, value.sourceAddress) ||
        !sameAddress(rescue.destination, value.destinationAddress) ||
        rescue.tokenId !== value.tokenId ||
        rescue.permitNonce !== message.nonce ||
        rescue.deadline !== expiry
      ) {
        context.addIssue({
          code: "custom",
          message: "ERC-4494 rescue authorization must bind the complete settlement scope",
          path: ["sourceSigningRequests", 1, "typedData", "message"],
        });
      }
    }
  });

export const signingPackageListSchema = z
  .array(signingPackageSchema)
  .min(1)
  .superRefine((packages, context) => {
    const packageIds = new Set<string>();
    const actionIds = new Set<string>();
    const first = packages[0];
    if (!first) return;

    packages.forEach((signingPackage, index) => {
      if (packageIds.has(signingPackage.packageId)) {
        context.addIssue({
          code: "custom",
          message: "Signing package IDs must be unique",
          path: [index, "packageId"],
        });
      }
      if (actionIds.has(signingPackage.actionId)) {
        context.addIssue({
          code: "custom",
          message: "A rescue action may only have one signing package",
          path: [index, "actionId"],
        });
      }
      packageIds.add(signingPackage.packageId);
      actionIds.add(signingPackage.actionId);

      const sharesPlanScope =
        signingPackage.jobId === first.jobId &&
        signingPackage.incidentId === first.incidentId &&
        signingPackage.planId === first.planId &&
        signingPackage.planHash.toLowerCase() === first.planHash.toLowerCase() &&
        signingPackage.chainId === first.chainId &&
        signingPackage.sourceAddress.toLowerCase() === first.sourceAddress.toLowerCase() &&
        signingPackage.destinationAddress.toLowerCase() === first.destinationAddress.toLowerCase() &&
        signingPackage.observedAtBlock === first.observedAtBlock;
      if (!sharesPlanScope) {
        context.addIssue({
          code: "custom",
          message: "Every signing package must share the same rescue-plan scope",
          path: [index],
        });
      }
    });
  });

export type SigningDomain = z.infer<typeof signingDomainSchema>;
export type SigningPackage = z.infer<typeof signingPackageSchema>;
export type SigningPackageList = z.infer<typeof signingPackageListSchema>;
export type RecoveryExecutionPath = z.infer<typeof recoveryExecutionPathSchema>;
export type AuthorizationStandard = z.infer<typeof authorizationStandardSchema>;

export function signingPackageExecutionMetadata(
  signingPackage: Pick<SigningPackage, "route">,
): {
  executionPath: RecoveryExecutionPath;
  authorizationStandard: AuthorizationStandard;
} {
  switch (signingPackage.route) {
    case "ERC3009_RECEIVE_WITH_AUTHORIZATION":
      return {
        executionPath: "DIRECT_AUTHORIZATION",
        authorizationStandard: "ERC3009",
      };
    case "ERC2612_PERMIT_SETTLEMENT":
      return {
        executionPath: "SAFEEXIT_SETTLEMENT",
        authorizationStandard: "ERC2612",
      };
    case "DAI_PERMIT_SETTLEMENT":
      return {
        executionPath: "SAFEEXIT_SETTLEMENT",
        authorizationStandard: "DAI_PERMIT",
      };
    case "ERC4494_PERMIT_SETTLEMENT":
      return {
        executionPath: "SAFEEXIT_SETTLEMENT",
        authorizationStandard: "ERC4494",
      };
  }
}
