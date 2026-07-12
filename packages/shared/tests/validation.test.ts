import { describe, expect, it } from "vitest";

import {
  chainIdSchema,
  evmAddressSchema,
  isEvmAddress,
  validateChainId,
  validateIncidentAddresses,
} from "../src/validation";

const sourceAddress = "0x1111111111111111111111111111111111111111";
const destinationAddress = "0x2222222222222222222222222222222222222222";

describe("EVM address validation", () => {
  it("accepts a 20-byte hexadecimal address", () => {
    expect(evmAddressSchema.parse(sourceAddress)).toBe(sourceAddress);
    expect(isEvmAddress(destinationAddress)).toBe(true);
  });

  it.each([
    "",
    "1111111111111111111111111111111111111111",
    "0x1234",
    "0xgggggggggggggggggggggggggggggggggggggggg",
    "0x11111111111111111111111111111111111111111",
  ])("rejects malformed address %j", (address) => {
    expect(evmAddressSchema.safeParse(address).success).toBe(false);
    expect(isEvmAddress(address)).toBe(false);
  });
});

describe("chain ID validation", () => {
  it.each([1, 196, 1952, 31_337])("accepts positive safe integer %d", (chainId) => {
    expect(validateChainId(chainId)).toBe(chainId);
  });

  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, "196"])(
    "rejects invalid chain ID %j",
    (chainId) => {
      expect(chainIdSchema.safeParse(chainId).success).toBe(false);
    },
  );
});

describe("incident address validation", () => {
  it("accepts different source and destination addresses", () => {
    expect(validateIncidentAddresses(sourceAddress, destinationAddress)).toEqual({
      sourceAddress,
      destinationAddress,
    });
  });

  it("rejects identical addresses case-insensitively", () => {
    const mixedCaseSource = "0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa";
    const lowerCaseSource = mixedCaseSource.toLowerCase();

    expect(() => validateIncidentAddresses(mixedCaseSource, lowerCaseSource)).toThrow(
      "Source and destination addresses must be different",
    );
  });

  it("rejects malformed addresses before comparing them", () => {
    expect(() => validateIncidentAddresses("not-an-address", destinationAddress)).toThrow();
  });
});

