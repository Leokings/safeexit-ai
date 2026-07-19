import {
  encodePaymentRequiredHeader,
  encodePaymentSignatureHeader,
} from "@okxweb3/x402-core/http";
import type {
  PaymentPayload,
  PaymentRequired,
} from "@okxweb3/x402-core/types";
import { describe, expect, it } from "vitest";

import {
  hasX402PaymentHeader,
  inspectX402Payment,
  inspectX402PaymentResponse,
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

describe("OKX x402 response inspection", () => {
  const paymentRequired: PaymentRequired = {
    x402Version: 2,
    error: "invalid_payload",
    resource: {
      url: "https://safeexit.xyz/api/agent/okx/prepare-paid",
      description: "Safe Exit",
      mimeType: "application/json",
    },
    accepts: [
      {
        scheme: "exact",
        network: "eip155:196",
        amount: "100000",
        asset: "0x779ded0c9e1022225f8e0630b35a9b54be713736",
        payTo: "0x4ab2b4be420a82031dc155c0be856ae383e0ba7e",
        maxTimeoutSeconds: 300,
        extra: {},
      },
    ],
  };

  it("extracts only the bounded payment error from a challenge", () => {
    const headers = new Headers({
      "payment-required": encodePaymentRequiredHeader(paymentRequired),
    });

    expect(inspectX402PaymentResponse(headers)).toEqual({
      kind: "PAYMENT_REQUIRED",
      error: "invalid_payload",
    });
  });

  it("does not invent a response diagnosis when the header is absent", () => {
    expect(inspectX402PaymentResponse(new Headers())).toEqual({ kind: "NONE" });
  });

  it("marks an invalid response header as malformed", () => {
    const headers = new Headers({ "payment-required": "not-base64-json" });
    expect(inspectX402PaymentResponse(headers)).toEqual({ kind: "MALFORMED" });
  });
});
