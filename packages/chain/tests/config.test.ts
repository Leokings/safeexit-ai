import { describe, expect, it } from "vitest";

import {
  anvilLocalConfig,
  configuredChains,
  createConfiguredPublicClient,
  createDedicatedPublicClient,
  defaultDevelopmentChainConfig,
  getChainAdapterConfig,
  primaryChainConfig,
  xLayerMainnetConfig,
  xLayerTestnetConfig,
} from "../src/config";

describe("chain adapter configuration", () => {
  it("uses X Layer mainnet as the primary configured chain", () => {
    expect(primaryChainConfig).toBe(xLayerMainnetConfig);
    expect(primaryChainConfig.chain.id).toBe(196);
    expect(primaryChainConfig.chain.nativeCurrency.symbol).toBe("OKB");
    expect(primaryChainConfig.rpcUrls).toEqual([
      "https://rpc.xlayer.tech",
      "https://xlayerrpc.okx.com",
    ]);
  });

  it("includes X Layer testnet with the official chain ID and RPCs", () => {
    expect(xLayerTestnetConfig.chain.id).toBe(1952);
    expect(xLayerTestnetConfig.environment).toBe("TESTNET");
    expect(xLayerTestnetConfig.rpcUrls).toEqual([
      "https://testrpc.xlayer.tech/terigon",
      "https://xlayertestrpc.okx.com/terigon",
    ]);
  });

  it("uses Anvil as the default local development chain", () => {
    expect(defaultDevelopmentChainConfig).toBe(anvilLocalConfig);
    expect(anvilLocalConfig.chain.id).toBe(31_337);
    expect(anvilLocalConfig.rpcUrls).toEqual(["http://127.0.0.1:8545"]);
    expect(anvilLocalConfig.scannerCapabilities.permit2Approvals).toBe(
      "UNSUPPORTED",
    );
  });

  it("resolves only configured chain IDs", () => {
    expect(getChainAdapterConfig(196)).toBe(xLayerMainnetConfig);
    expect(getChainAdapterConfig(1952)).toBe(xLayerTestnetConfig);
    expect(getChainAdapterConfig(31_337)).toBe(anvilLocalConfig);
    expect(() => getChainAdapterConfig(1)).toThrow("Unsupported chain ID: 1");
    expect(configuredChains).toHaveLength(3);
  });

  it("refuses an RPC URL that is not in the chain configuration", () => {
    expect(() =>
      createConfiguredPublicClient(xLayerMainnetConfig, "https://rpc.example"),
    ).toThrow("RPC URL is not configured for chain 196");
  });

  it("accepts a dedicated HTTPS production RPC without changing chain identity", () => {
    const client = createDedicatedPublicClient(
      xLayerMainnetConfig,
      "https://rpc.provider.example/xlayer",
    );
    expect(client.chain.id).toBe(196);
    expect(() =>
      createDedicatedPublicClient(xLayerMainnetConfig, "http://rpc.example"),
    ).toThrow("Dedicated production RPC URLs must use HTTPS");
  });
});
