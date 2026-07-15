import type { NextConfig } from "next";
import { createSecurityHeaders } from "@safeexit/security/headers";

const nextConfig: NextConfig = {
  transpilePackages: [
    "@safeexit/agent-service",
    "@safeexit/ai",
    "@safeexit/persistence",
    "@safeexit/security",
    "@safeexit/shared",
  ],
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: createSecurityHeaders(process.env.NODE_ENV !== "production"),
      },
      {
        source: "/rescue/:path*",
        headers: [
          { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive, nosnippet" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "Cache-Control", value: "private, no-store, max-age=0" },
        ],
      },
    ];
  },
};

export default nextConfig;
