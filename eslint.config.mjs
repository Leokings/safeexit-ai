import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTypeScript,
  globalIgnores([
    "**/.next/**",
    "**/coverage/**",
    "**/contracts/artifacts/**",
    "**/contracts/cache/**",
    "**/contracts/out/**",
    "**/packages/persistence/src/generated/**",
  ]),
  {
    rules: {
      "@next/next/no-html-link-for-pages": "off",
    },
  },
]);
