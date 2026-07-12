import { z } from "zod";

import {
  chainIdSchema,
  evmAddressSchema,
  expectedEffectSchema,
  walletScanSchema,
  type EvmAddress,
} from "@safeexit/shared";

const identifierSchema = z.string().min(1).max(256);
const baseUnitAmountSchema = z.string().regex(/^(0|[1-9]\d*)$/);
const estimatedValueUsdSchema = z.number().finite().nonnegative();
const riskLevelSchema = z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);

const outputCommonShape = {
  id: identifierSchema,
  estimatedValueUsd: estimatedValueUsdSchema.optional(),
} satisfies z.ZodRawShape;

export const adapterErc20OutputSchema = z.strictObject({
  ...outputCommonShape,
  assetType: z.literal("ERC20"),
  tokenAddress: evmAddressSchema,
  amount: baseUnitAmountSchema,
});

export const adapterErc721OutputSchema = z.strictObject({
  ...outputCommonShape,
  assetType: z.literal("ERC721"),
  collectionAddress: evmAddressSchema,
  tokenId: baseUnitAmountSchema,
});

export const adapterErc1155OutputSchema = z.strictObject({
  ...outputCommonShape,
  assetType: z.literal("ERC1155"),
  collectionAddress: evmAddressSchema,
  tokenId: baseUnitAmountSchema,
  amount: baseUnitAmountSchema,
});

export const adapterOutputSchema = z.discriminatedUnion("assetType", [
  adapterErc20OutputSchema,
  adapterErc721OutputSchema,
  adapterErc1155OutputSchema,
]);

const adapterCandidateCommonShape = {
  id: identifierSchema,
  evidenceId: identifierSchema,
  verification: z.literal("VERIFIED_ADAPTER"),
  adapterId: identifierSchema,
  adapterVersion: z.string().min(1).max(64),
  chainId: chainIdSchema,
  sourceAddress: evmAddressSchema,
  contractAddress: evmAddressSchema,
  description: z.string().min(1).max(500),
  riskLevel: riskLevelSchema,
  estimatedValueUsd: estimatedValueUsdSchema.optional(),
  expectedEffects: z.array(expectedEffectSchema),
  outputs: z.array(adapterOutputSchema),
} satisfies z.ZodRawShape;

export const claimAdapterCandidateSchema = z.strictObject({
  ...adapterCandidateCommonShape,
  actionType: z.literal("CLAIM_SUPPORTED_AIRDROP"),
  claimReference: z.string().min(1).max(256),
});

export const withdrawAdapterCandidateSchema = z.strictObject({
  ...adapterCandidateCommonShape,
  actionType: z.literal("WITHDRAW_SUPPORTED_POSITION"),
  positionId: z.string().min(1).max(256),
});

export const customAdapterCandidateSchema = z.strictObject({
  ...adapterCandidateCommonShape,
  actionType: z.literal("CUSTOM_SUPPORTED_ADAPTER"),
  operationId: z.string().min(1).max(256),
});

export const supportedAdapterCandidateSchema = z.discriminatedUnion("actionType", [
  claimAdapterCandidateSchema,
  withdrawAdapterCandidateSchema,
  customAdapterCandidateSchema,
]);

export const trustedAdapterConfigSchema = z.strictObject({
  adapterId: identifierSchema,
  adapterVersion: z.string().min(1).max(64),
  chainId: chainIdSchema,
  contractAddress: evmAddressSchema,
  supportedActions: z
    .array(
      z.enum([
        "CLAIM_SUPPORTED_AIRDROP",
        "WITHDRAW_SUPPORTED_POSITION",
        "CUSTOM_SUPPORTED_ADAPTER",
      ]),
    )
    .min(1),
  allowedOutputContracts: z.array(evmAddressSchema).default([]),
  allowedCustomOperationIds: z.array(identifierSchema).default([]),
});

export const rescuePlanningRequestSchema = z.strictObject({
  incidentId: identifierSchema,
  destinationAddress: evmAddressSchema,
  policyVersion: z.string().min(1).max(64),
  scan: walletScanSchema,
  adapterCandidates: z.array(supportedAdapterCandidateSchema).default([]),
});

export type AdapterOutput = z.infer<typeof adapterOutputSchema>;
export type SupportedAdapterCandidate = z.infer<
  typeof supportedAdapterCandidateSchema
>;
export type TrustedAdapterConfig = z.output<typeof trustedAdapterConfigSchema>;
export type TrustedAdapterConfigInput = z.input<typeof trustedAdapterConfigSchema>;
export type TrustedAdapterOutputContract = EvmAddress;
export type RescuePlanningRequest = z.input<typeof rescuePlanningRequestSchema>;
export type ParsedRescuePlanningRequest = z.output<typeof rescuePlanningRequestSchema>;
