import { describe, expect, it, vi } from "vitest";

import { parseDeploymentEnvironment } from "./deployment-env";
import { getConfiguredRpcEndpoints, probeConfiguredRpcEndpoints } from "./rpc-endpoints";

describe("server-only multichain RPC endpoints", () => {
  it("maps configured mainnets without exposing unconfigured entries", () => {
    const config = parseDeploymentEnvironment({
      NODE_ENV: "production",
      ETHEREUM_MAINNET_RPC_URL: "https://ethereum.example/key",
      XLAYER_MAINNET_RPC_URL: "https://xlayer.example/key",
    });

    expect(getConfiguredRpcEndpoints(config)).toEqual([
      expect.objectContaining({ chainId: 1, rescueSupport: "ENABLED" }),
      expect.objectContaining({ chainId: 196, rescueSupport: "ENABLED" }),
    ]);
  });

  it("fails readiness when an endpoint reports the wrong chain", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      new Response(JSON.stringify({ jsonrpc: "2.0", id: 0, result: "0x38" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const config = parseDeploymentEnvironment({
      NODE_ENV: "production",
      ETHEREUM_MAINNET_RPC_URL: "https://ethereum.example/key",
    });

    await expect(probeConfiguredRpcEndpoints(config)).rejects.toThrow(
      "Ethereum RPC reported chain 56; expected 1",
    );
    fetchMock.mockRestore();
  });
});
