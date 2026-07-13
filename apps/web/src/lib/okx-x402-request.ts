import { decodePaymentSignatureHeader } from "@okxweb3/x402-core/http";

type PaymentInspection =
  | { kind: "NONE" }
  | { kind: "MALFORMED" }
  | { kind: "DISTINCT_PARTIES"; from: string; to: string }
  | { kind: "SELF_PAYMENT"; address: string };

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
