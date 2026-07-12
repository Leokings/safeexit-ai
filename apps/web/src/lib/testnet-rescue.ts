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

export const testnetPreflightResponseSchema = z.strictObject({
  chainId: z.literal(XLAYER_TESTNET_CHAIN_ID),
  scan: walletScanSchema,
  plan: rescuePlanSchema,
  simulations: z.array(simulationResultSchema),
  executableActionIds: z.array(z.string().min(1).max(256)),
  excludedActionIds: z.array(z.string().min(1).max(256)),
});

export type TestnetPreflightRequest = z.infer<typeof testnetPreflightRequestSchema>;
export type TestnetPreflightResponse = z.infer<typeof testnetPreflightResponseSchema>;
