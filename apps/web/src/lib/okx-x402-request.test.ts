import { encodePaymentSignatureHeader } from "@okxweb3/x402-core/http";
import type { PaymentPayload } from "@okxweb3/x402-core/types";
import { describe, expect, it } from "vitest";

import {
  hasX402PaymentHeader,
  inspectX402Payment,
} from "./okx-x402-request";

const payer = "0x1111111111111111111111111111111111111111";
const payee = "0x2222222222222222222222222222222222222222";

function paymentHeader(from: string, to: string): string {
  return encodePaymentSignatureHeader({
    x402Version: 2,
    accepted: {
      scheme: "exact",
      network: "eip155:196",
      asset: "0x779ded0c9e1022225f8e0630b35a9b54be713736",
      amount: "100000",
      payTo: to,
      maxTimeoutSeconds: 300,
      extra: { name: "USDT0", version: "1" },
    },
    payload: {
      signature: "0xsignature",
      authorization: {
        from,
        to,
        value: "100000",
        validAfter: "0",
        validBefore: "9999999999",
        nonce: "0xnonce",
      },
    },
  } as PaymentPayload);
}

describe("OKX x402 request inspection", () => {
  it("recognizes an unpaid request", () => {
    const headers = new Headers();
    expect(hasX402PaymentHeader(headers)).toBe(false);
    expect(inspectX402Payment(headers)).toEqual({ kind: "NONE" });
  });

  it("rejects payer and recipient reuse before settlement", () => {
    const headers = new Headers({
      "payment-signature": paymentHeader(payer, payer.toUpperCase()),
    });
    expect(hasX402PaymentHeader(headers)).toBe(true);
    expect(inspectX402Payment(headers)).toEqual({
      kind: "SELF_PAYMENT",
      address: payer,
    });
  });

  it("allows distinct payment parties", () => {
    const headers = new Headers({ "x-payment": paymentHeader(payer, payee) });
    expect(inspectX402Payment(headers)).toEqual({
      kind: "DISTINCT_PARTIES",
      from: payer,
      to: payee,
    });
  });

  it("leaves malformed payment headers to the official middleware", () => {
    expect(
      inspectX402Payment(
        new Headers({ "payment-signature": "not-base64-json" }),
      ),
    ).toEqual({ kind: "MALFORMED" });
  });
});
