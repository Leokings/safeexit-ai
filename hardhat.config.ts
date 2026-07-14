import hardhatViemPlugin from "@nomicfoundation/hardhat-viem";
import { defineConfig } from "hardhat/config";

export default defineConfig({
  plugins: [hardhatViemPlugin],
  paths: {
    sources: "./contracts/src",
    tests: "./contracts/test",
    cache: "./contracts/cache",
    artifacts: "./contracts/artifacts",
  },
  solidity: {
    profiles: {
      default: {
        version: "0.8.36",
        settings: {
          evmVersion: "shanghai",
        },
      },
      production: {
        version: "0.8.36",
        settings: {
          evmVersion: "shanghai",
          optimizer: {
            enabled: true,
            runs: 200,
          },
        },
      },
    },
  },
  networks: {
    hardhatMainnet: {
      type: "edr-simulated",
      chainType: "l1",
    },
  },
});
