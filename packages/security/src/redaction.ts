const REDACTED = "[REDACTED]";
const SENSITIVE_KEYS = new Set([
  "authorization",
  "calldata",
  "connectionstring",
  "cookie",
  "credentials",
  "databaseurl",
  "directurl",
  "keystore",
  "mnemonic",
  "password",
  "privatekey",
  "rawcredentials",
  "rawtransaction",
  "seed",
  "seedphrase",
  "signature",
  "signedtransaction",
  "transactiondata",
]);

function normalizeKey(key: string): string {
  return key.toLowerCase().replaceAll(/[^a-z0-9]/g, "");
}

function redactString(value: string): string {
  return value
    .replace(/\bBearer\s+[^\s,;]+/gi, `Bearer ${REDACTED}`)
    .replace(
      /(OK-ACCESS-(?:KEY|SIGN|PASSPHRASE)\s*[:=]\s*)[^\s,;]+/gi,
      `$1${REDACTED}`,
    )
    .replace(/postgres(?:ql)?:\/\/[^\s]+/gi, REDACTED)
    .replace(/https?:\/\/[^\s"')]+/gi, "[REDACTED_URL]");
}

export function redactSensitive(value: unknown, depth = 0): unknown {
  if (depth > 12) {
    return "[MAX_DEPTH]";
  }
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (typeof value === "string") {
    return redactString(value);
  }
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (value instanceof Error) {
    return { name: value.name, message: redactString(value.message) };
  }
  if (Array.isArray(value)) {
    return value.map((entry) => redactSensitive(entry, depth + 1));
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      SENSITIVE_KEYS.has(normalizeKey(key))
        ? REDACTED
        : redactSensitive(entry, depth + 1),
    ]),
  );
}

export type LogSink = Pick<Console, "info" | "warn" | "error">;

export function createSecureLogger(sink: LogSink = console) {
  function write(
    level: keyof LogSink,
    message: string,
    context: Record<string, unknown> = {},
  ): void {
    const redacted = redactSensitive(context);
    const safeContext =
      redacted !== null && typeof redacted === "object" && !Array.isArray(redacted)
        ? (redacted as Record<string, unknown>)
        : {};
    sink[level](JSON.stringify({ message, ...safeContext }));
  }
  return {
    info: (message: string, context?: Record<string, unknown>) =>
      write("info", message, context),
    warn: (message: string, context?: Record<string, unknown>) =>
      write("warn", message, context),
    error: (message: string, context?: Record<string, unknown>) =>
      write("error", message, context),
  };
}
