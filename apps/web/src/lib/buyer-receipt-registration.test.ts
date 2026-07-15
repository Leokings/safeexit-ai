import { describe, expect, it } from "vitest";

import type { SigningPackage } from "@safeexit/agent-service";

import { assertReceiptSubmissionTransaction } from "./buyer-receipt-registration";

const destination = "0x2222222222222222222222222222222222222222" as const;
const token = "0x3333333333333333333333333333333333333333" as const;
const settlement = "0x4444444444444444444444444444444444444444" as const;
const other = "0x5555555555555555555555555555555555555555" as const;

const directPackage = {
  route: "ERC3009_RECEIVE_WITH_AUTHORIZATION",
  destinationAddress: destination,
  tokenAddress: token,
} as SigningPackage;

const settlementPackage = {
  route: "ERC2612_PERMIT_SETTLEMENT",
  destinationAddress: destination,
  settlementContract: settlement,
} as SigningPackage;

describe("buyer receipt registration", () => {
  it("accepts a destination-submitted transaction to the issued route target", () => {
    expect(() => assertReceiptSubmissionTransaction(directPackage, {
      from: destination,
      to: token,
      value: 0n,
    })).not.toThrow();
    expect(() => assertReceiptSubmissionTransaction(settlementPackage, {
      from: destination,
      to: settlement,
      value: 0n,
    })).not.toThrow();
  });

  it("rejects another sender, another target, and native value", () => {
    expect(() => assertReceiptSubmissionTransaction(directPackage, {
      from: other,
      to: token,
      value: 0n,
    })).toThrow("committed destination");
    expect(() => assertReceiptSubmissionTransaction(directPackage, {
      from: destination,
      to: other,
      value: 0n,
    })).toThrow("issued recovery route");
    expect(() => assertReceiptSubmissionTransaction(directPackage, {
      from: destination,
      to: token,
      value: 1n,
    })).toThrow("native value");
  });
});
