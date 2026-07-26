import { cp, mkdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const projectDirectory = dirname(fileURLToPath(import.meta.url));
const outputDirectory = resolve(projectDirectory, "dist");
const development = process.argv.includes("--development");

if (!outputDirectory.startsWith(`${projectDirectory}\\`)) {
  throw new Error("Refusing to write extension output outside its project directory");
}

await rm(outputDirectory, { recursive: true, force: true });
await mkdir(outputDirectory, { recursive: true });

await build({
  entryPoints: {
    background: resolve(projectDirectory, "src/background.ts"),
    popup: resolve(projectDirectory, "src/popup.ts"),
    "wdk-signer": resolve(projectDirectory, "src/wdk-signer.ts"),
  },
  bundle: true,
  format: "esm",
  outdir: outputDirectory,
  platform: "browser",
  target: "chrome120",
  sourcemap: false,
  minify: false,
  logLevel: "info",
});

await build({
  entryPoints: {
    content: resolve(projectDirectory, "src/content.ts"),
  },
  bundle: true,
  format: "iife",
  outdir: outputDirectory,
  platform: "browser",
  target: "chrome120",
  sourcemap: false,
  minify: false,
  logLevel: "info",
});

await cp(resolve(projectDirectory, "public"), outputDirectory, {
  recursive: true,
  force: true,
});
if (development) {
  await cp(
    resolve(projectDirectory, "public", "manifest.development.json"),
    resolve(outputDirectory, "manifest.json"),
    { force: true },
  );
}
await rm(resolve(outputDirectory, "manifest.development.json"), {
  force: true,
});
