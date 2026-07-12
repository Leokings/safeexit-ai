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
    ];
  },
};

export default nextConfig;
