export type SecurityHeader = Readonly<{ key: string; value: string }>;

export function createContentSecurityPolicy(isDevelopment: boolean): string {
  const scriptSources = ["'self'", "'unsafe-inline'"];
  const connectSources = [
    "'self'",
    "https://rpc.xlayer.tech",
    "https://xlayerrpc.okx.com",
  ];
  if (isDevelopment) {
    scriptSources.push("'unsafe-eval'");
    connectSources.push("http://localhost:*", "ws://localhost:*");
  }

  return [
    "default-src 'self'",
    `script-src ${scriptSources.join(" ")}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src ${connectSources.join(" ")}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(isDevelopment ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
}

export function createSecurityHeaders(isDevelopment: boolean): SecurityHeader[] {
  return [
    { key: "Content-Security-Policy", value: createContentSecurityPolicy(isDevelopment) },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
    {
      key: "Permissions-Policy",
      value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
    },
    ...(!isDevelopment
      ? [
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
        ]
      : []),
  ];
}
