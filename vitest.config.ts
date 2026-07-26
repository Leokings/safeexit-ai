import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      include: ["packages/*/src/**/*.ts"],
    },
    include: [
      "packages/**/*.test.ts",
      "apps/web/src/**/*.test.ts",
      "apps/signer-extension/tests/**/*.test.ts",
    ],
  },
});
