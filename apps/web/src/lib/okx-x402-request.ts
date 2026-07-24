import {
  decodePaymentRequiredHeader,
  decodePaymentSignatureHeader,
} from "@okxweb3/x402-core/http";

type PaymentInspection =
  | { kind: "NONE" }
  | { kind: "MALFORMED" }
  | { kind: "DISTINCT_PARTIES"; from: string; to: string }
  | { kind: "SELF_PAYMENT"; address: string };

type PaymentResponseInspection =
  | { kind: "NONE" }
  | { kind: "MALFORMED" }
  | { kind: "PAYMENT_REQUIRED"; error?: string };

export type X402PaymentFailureDetail = {
  code: "X402_INSUFFICIENT_BALANCE";
  message: string;
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

export function hasX402PaymentHeader(headers: Headers): boolean {
  return Boolean(
    headers.get("payment-signature") ?? headers.get("x-payment"),
  );
}

export function inspectX402Payment(headers: Headers): PaymentInspection {
  const header =
    headers.get("payment-signature") ?? headers.get("x-payment");
  if (!header) {
    return { kind: "NONE" };
  }

  try {
    const payment = asRecord(decodePaymentSignatureHeader(header));
    const payload = asRecord(payment?.payload);
    const authorization = asRecord(payload?.authorization);
    const from = authorization?.from;
    const to = authorization?.to;
    if (typeof from !== "string" || typeof to !== "string") {
      return { kind: "MALFORMED" };
    }
    if (from.toLowerCase() === to.toLowerCase()) {
      return { kind: "SELF_PAYMENT", address: from };
    }
    return { kind: "DISTINCT_PARTIES", from, to };
  } catch {
    return { kind: "MALFORMED" };
  }
}

export function inspectX402PaymentResponse(
  headers: Headers,
): PaymentResponseInspection {
  const header = headers.get("payment-required");
  if (!header) {
    return { kind: "NONE" };
  }

  try {
    const paymentRequired = decodePaymentRequiredHeader(header);
    const error =
      typeof paymentRequired.error === "string"
        ? paymentRequired.error.slice(0, 160)
        : undefined;
    return {
      kind: "PAYMENT_REQUIRED",
      ...(error ? { error } : {}),
    };
  } catch {
    return { kind: "MALFORMED" };
  }
}

export function describeX402PaymentFailure(
  error: string | undefined,
): X402PaymentFailureDetail | undefined {
  if (error !== "insufficient_balance") {
    return undefined;
  }

  return {
    code: "X402_INSUFFICIENT_BALANCE",
    message:
      "The buyer payment wallet does not hold enough USD₮0 on X Layer for this 0.1 USD₮0 call. Fund the buyer payment wallet, not the compromised source wallet, then create a fresh quote.",
  };
}
