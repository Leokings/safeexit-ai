import { z } from "zod";

export const evmAddressSchema = z
  .string()
  .regex(/^0x[a-fA-F0-9]{40}$/, "Expected a 20-byte EVM address")
  .brand<"EvmAddress">();

export type EvmAddress = z.infer<typeof evmAddressSchema>;

export const chainIdSchema = z
  .number()
  .int("Chain ID must be an integer")
  .positive("Chain ID must be positive")
  .max(Number.MAX_SAFE_INTEGER, "Chain ID exceeds JavaScript's safe integer range");

export const incidentAddressPairSchema = z
  .strictObject({
    sourceAddress: evmAddressSchema,
    destinationAddress: evmAddressSchema,
  })
  .superRefine(({ sourceAddress, destinationAddress }, context) => {
    if (sourceAddress.toLowerCase() === destinationAddress.toLowerCase()) {
      context.addIssue({
        code: "custom",
        message: "Source and destination addresses must be different",
        path: ["destinationAddress"],
      });
    }
  });

export type IncidentAddressPair = z.infer<typeof incidentAddressPairSchema>;

export function isEvmAddress(value: unknown): value is EvmAddress {
  return evmAddressSchema.safeParse(value).success;
}

export function validateChainId(value: unknown): number {
  return chainIdSchema.parse(value);
}

export function validateIncidentAddresses(
  sourceAddress: unknown,
  destinationAddress: unknown,
): IncidentAddressPair {
  return incidentAddressPairSchema.parse({ sourceAddress, destinationAddress });
}

