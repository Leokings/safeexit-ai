import { readFile, stat } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const manifestUrl = new URL("../public/manifest.json", import.meta.url);
const developmentManifestUrl = new URL(
  "../public/manifest.development.json",
  import.meta.url,
);

describe("source signer manifest", () => {
  it("permits packaged WDK WebAssembly without allowing string evaluation", async () => {
    const manifest = JSON.parse(
      await readFile(manifestUrl, "utf8"),
    ) as Record<string, unknown>;
    const contentSecurityPolicy = manifest.content_security_policy as {
      extension_pages?: unknown;
    };

    expect(manifest.manifest_version).toBe(3);
    expect(manifest.minimum_chrome_version).toBe("127");
    expect(contentSecurityPolicy.extension_pages).toBe(
      "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'; connect-src https://rpc.xlayer.tech https://xlayerrpc.okx.com",
    );
    expect(
      String(contentSecurityPolicy.extension_pages).split(/\s+/),
    ).not.toContain("'unsafe-eval'");
    expect(manifest.permissions).toEqual(["storage"]);
    expect(manifest).not.toHaveProperty("web_accessible_resources");
    expect(manifest.icons).toEqual({
      "16": "icons/icon16.png",
      "32": "icons/icon32.png",
      "48": "icons/icon48.png",
      "128": "icons/icon128.png",
    });
    await expect(
      stat(new URL("../public/icons/icon128.png", import.meta.url)),
    ).resolves.toMatchObject({ size: expect.any(Number) });

    const productionMatches = (
      manifest.content_scripts as Array<{ matches?: string[] }>
    ).flatMap((contentScript) => contentScript.matches ?? []);
    const hostPermissions = manifest.host_permissions as string[];

    expect(productionMatches).toEqual(["https://safeexit.xyz/*"]);
    expect(hostPermissions).toEqual([
      "https://safeexit.xyz/*",
      "https://rpc.xlayer.tech/*",
      "https://xlayerrpc.okx.com/*",
    ]);
    expect(hostPermissions.every((entry) => entry.startsWith("https://"))).toBe(
      true,
    );
  });

  it("keeps localhost access in the explicit development manifest only", async () => {
    const manifest = JSON.parse(
      await readFile(developmentManifestUrl, "utf8"),
    ) as Record<string, unknown>;
    const localMatches = [
      "http://127.0.0.1:3000/*",
      "http://localhost:3000/*",
      "http://127.0.0.1:4179/*",
      "http://localhost:4179/*",
    ];
    const developmentMatches = (
      manifest.content_scripts as Array<{ matches?: string[] }>
    ).flatMap((contentScript) => contentScript.matches ?? []);
    const hostPermissions = manifest.host_permissions as string[];

    expect(developmentMatches).toEqual(
      expect.arrayContaining(localMatches),
    );
    expect(hostPermissions).toEqual(expect.arrayContaining(localMatches));
  });
});
