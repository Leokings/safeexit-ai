import { z } from "zod";

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
  route: z.literal("ERC2612_PERMIT_ATOMIC_BATCH"),
  tokenAddress: evmAddressSchema,
  amount: positiveBaseUnitAmountSchema,
  sourceSigningRequests: z.tuple([erc2612SigningRequestSchema]),
  destinationSettlement: z.strictObject({
    ...settlementCommonShape,
    atomicRequired: z.literal(true),
    operations: z.tuple([
      z.literal("PERMIT_ERC2612"),
      z.literal("TRANSFER_FROM_ERC20"),
    ]),
  }),
});

const daiPermitPackageSchema = z.strictObject({
  ...packageCommonShape,
  route: z.literal("DAI_PERMIT_ATOMIC_BATCH"),
  tokenAddress: evmAddressSchema,
  amount: positiveBaseUnitAmountSchema,
  sourceSigningRequests: z.tuple([daiSigningRequestSchema, daiSigningRequestSchema]),
  destinationSettlement: z.strictObject({
    ...settlementCommonShape,
    atomicRequired: z.literal(true),
    operations: z.tuple([
      z.literal("PERMIT_DAI_ALLOW"),
      z.literal("TRANSFER_FROM_ERC20"),
      z.literal("PERMIT_DAI_REVOKE"),
    ]),
  }),
});

const erc4494PackageSchema = z.strictObject({
  ...packageCommonShape,
  route: z.literal("ERC4494_PERMIT_ATOMIC_BATCH"),
  collectionAddress: evmAddressSchema,
  tokenId: baseUnitAmountSchema,
  sourceSigningRequests: z.tuple([erc4494SigningRequestSchema]),
  destinationSettlement: z.strictObject({
    ...settlementCommonShape,
    atomicRequired: z.literal(true),
    operations: z.tuple([
      z.literal("PERMIT_ERC4494"),
      z.literal("TRANSFER_FROM_ERC721"),
    ]),
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
    const expectedContract = value.route === "ERC4494_PERMIT_ATOMIC_BATCH"
      ? value.collectionAddress
      : value.tokenAddress;
    value.sourceSigningRequests.forEach((request, index) => {
      if (!sameAddress(request.typedData.domain.verifyingContract, expectedContract)) {
        context.addIssue({
          code: "custom",
          message: "Signing domain contract must match the committed asset contract",
          path: ["sourceSigningRequests", index, "typedData", "domain", "verifyingContract"],
        });
      }
    });
    if (value.route === "ERC3009_RECEIVE_WITH_AUTHORIZATION") {
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
    }
    if (value.route === "ERC2612_PERMIT_ATOMIC_BATCH") {
      const message = value.sourceSigningRequests[0].typedData.message;
      if (
        !sameAddress(message.owner, value.sourceAddress) ||
        !sameAddress(message.spender, value.destinationAddress) ||
        message.value !== value.amount ||
        message.deadline !== expiry
      ) {
        context.addIssue({
          code: "custom",
          message: "ERC-2612 permit must match the committed transfer scope",
          path: ["sourceSigningRequests", 0, "typedData", "message"],
        });
      }
    }
    if (value.route === "DAI_PERMIT_ATOMIC_BATCH") {
      const [allow, revoke] = value.sourceSigningRequests;
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
      for (const [index, request] of value.sourceSigningRequests.entries()) {
        const message = request.typedData.message;
        if (
          !sameAddress(message.holder, value.sourceAddress) ||
          !sameAddress(message.spender, value.destinationAddress) ||
          message.expiry !== expiry
        ) {
          context.addIssue({
            code: "custom",
            message: "DAI-style permit must match the committed transfer scope",
            path: ["sourceSigningRequests", index, "typedData", "message"],
          });
        }
      }
    }
    if (value.route === "ERC4494_PERMIT_ATOMIC_BATCH") {
      const message = value.sourceSigningRequests[0].typedData.message;
      if (
        !sameAddress(message.spender, value.destinationAddress) ||
        message.tokenId !== value.tokenId ||
        message.deadline !== expiry
      ) {
        context.addIssue({
          code: "custom",
          message: "ERC-4494 permit must match the committed NFT transfer scope",
          path: ["sourceSigningRequests", 0, "typedData", "message"],
        });
      }
    }
  });

export type SigningDomain = z.infer<typeof signingDomainSchema>;
export type SigningPackage = z.infer<typeof signingPackageSchema>;
