import { describe, expect, it } from "vitest";

import {
  anvilLocalConfig,
  configuredChains,
  createConfiguredPublicClient,
  createDedicatedPublicClient,
  defaultDevelopmentChainConfig,
  getChainAdapterConfig,
  getRescueMainnetChainConfig,
  isRescueMainnetChainId,
  primaryChainConfig,
  RESCUE_MAINNET_CHAIN_IDS,
  xLayerMainnetConfig,
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

  it("uses Anvil as the default local development chain", () => {
    expect(defaultDevelopmentChainConfig).toBe(anvilLocalConfig);
    expect(anvilLocalConfig.chain.id).toBe(31_337);
    expect(anvilLocalConfig.rpcUrls).toEqual(["http://127.0.0.1:8545"]);
    expect(anvilLocalConfig.scannerCapabilities.permit2Approvals).toBe(
      "UNSUPPORTED",
    );
  });

  it("resolves every verified rescue mainnet and the local chain", () => {
    expect(getChainAdapterConfig(196)).toBe(xLayerMainnetConfig);
    expect(getChainAdapterConfig(31_337)).toBe(anvilLocalConfig);
    expect(getRescueMainnetChainConfig(1).chain.name).toBe("Ethereum");
    expect(getRescueMainnetChainConfig(8_453).chain.name).toBe("Base");
    expect(RESCUE_MAINNET_CHAIN_IDS).toEqual([
      1, 56, 137, 42_161, 10, 8_453, 43_114, 196,
    ]);
    expect(isRescueMainnetChainId(43_114)).toBe(true);
    expect(isRescueMainnetChainId(10_001)).toBe(false);
    expect(() => getChainAdapterConfig(10_001)).toThrow("Unsupported chain ID: 10001");
    expect(() => getRescueMainnetChainConfig(31_337)).toThrow(
      "Unsupported rescue mainnet chain ID: 31337",
    );
    expect(configuredChains).toHaveLength(9);
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
