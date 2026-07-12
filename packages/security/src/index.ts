import {
  evmAddressSchema,
  validateIncidentAddresses,
  type EvmAddress,
  type IncidentAddressPair,
} from "@safeexit/shared";

export function assertEvmAddress(value: unknown): EvmAddress {
  return evmAddressSchema.parse(value);
}

export function assertSafeIncidentAddresses(
  sourceAddress: unknown,
  destinationAddress: unknown,
): IncidentAddressPair {
  return validateIncidentAddresses(sourceAddress, destinationAddress);
}

export * from "./api";
export * from "./headers";
export * from "./rate-limit";
export * from "./redaction";
