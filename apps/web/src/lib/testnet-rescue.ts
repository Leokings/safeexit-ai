import { z } from "zod";

import {
  evmAddressSchema,
  rescuePlanSchema,
  simulationResultSchema,
  walletScanSchema,
} from "@safeexit/shared";

export const XLAYER_TESTNET_CHAIN_ID = 1_952;
export const XLAYER_TESTNET_CHAIN_HEX = "0x7a0";

export const testnetPreflightRequestSchema = z.strictObject({
  tokenAddresses: z.array(evmAddressSchema).max(8),
});

export const eip712DomainSchema = z.strictObject({
  name: z.string().min(1).max(128),
  version: z.string().min(1).max(32),
  chainId: z.literal(XLAYER_TESTNET_CHAIN_ID),
  verifyingContract: evmAddressSchema,
});

export const eip3009RescueActionSchema = z.strictObject({
  actionId: z.string().min(1).max(256),
  standard: z.literal("ERC3009_RECEIVE_WITH_AUTHORIZATION"),
  capabilityStatus: z.literal("VERIFIED"),
  tokenAddress: evmAddressSchema,
  from: evmAddressSchema,
  to: evmAddressSchema,
  amount: z.string().regex(/^(0|[1-9]\d*)$/),
  domain: eip712DomainSchema,
});

export const erc2612RescueActionSchema = z.strictObject({
  actionId: z.string().min(1).max(256),
  standard: z.literal("ERC2612_PERMIT_ATOMIC_BATCH"),
  capabilityStatus: z.literal("SIGNATURE_VERIFICATION_REQUIRED"),
  tokenAddress: evmAddressSchema,
  from: evmAddressSchema,
  to: evmAddressSchema,
  amount: z.string().regex(/^(0|[1-9]\d*)$/),
  nonce: z.string().regex(/^(0|[1-9]\d*)$/),
  domain: eip712DomainSchema,
  requiredWalletCapability: z.literal("ATOMIC_BATCH"),
});

export const gaslessRescueActionSchema = z.discriminatedUnion("standard", [
  eip3009RescueActionSchema,
  erc2612RescueActionSchema,
]);

export const blockedGaslessActionSchema = z.strictObject({
  actionId: z.string().min(1).max(256),
  reason: z.string().min(1).max(500),
});

export const testnetPreflightResponseSchema = z.strictObject({
  chainId: z.literal(XLAYER_TESTNET_CHAIN_ID),
  scan: walletScanSchema,
  plan: rescuePlanSchema,
  simulations: z.array(simulationResultSchema),
  sourceFundedExecutionDisabled: z.literal(true),
  gaslessActions: z.array(gaslessRescueActionSchema),
  blockedActions: z.array(blockedGaslessActionSchema),
});

export type TestnetPreflightRequest = z.infer<typeof testnetPreflightRequestSchema>;
export type TestnetPreflightResponse = z.infer<typeof testnetPreflightResponseSchema>;
export type Eip712Domain = z.infer<typeof eip712DomainSchema>;
export type GaslessRescueAction = z.infer<typeof gaslessRescueActionSchema>;
export type Eip3009RescueAction = z.infer<typeof eip3009RescueActionSchema>;
export type Erc2612RescueAction = z.infer<typeof erc2612RescueActionSchema>;
