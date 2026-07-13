import { describe, expect, it } from "vitest";

import { parseDeploymentEnvironment } from "./deployment-env";
import {
  createSafeExitX402RouteConfig,
  getSafeExitX402Configuration,
  SAFEEXIT_X402_NETWORK,
  SAFEEXIT_X402_PRICE,
} from "./okx-x402-config";

function configuredEnvironment() {
  return parseDeploymentEnvironment({
    NODE_ENV: "production",
    SAFEEXIT_X402_MODE: "MAINNET",
    SAFEEXIT_X402_PAY_TO_ADDRESS: "0x4ab2b4be420a82031dc155c0be856ae383e0ba7e",
    OKX_WEB3_API_KEY: "api-key",
    OKX_WEB3_SECRET_KEY: "secret-key",
    OKX_WEB3_PASSPHRASE: "passphrase",
  });
}

describe("OKX x402 configuration", () => {
  it("pins the paid deterministic endpoint to X Layer and 0.1 USDT", () => {
    const configuration = getSafeExitX402Configuration(configuredEnvironment());
    expect(configuration).toEqual({
      network: SAFEEXIT_X402_NETWORK,
      payTo: "0x4ab2b4be420a82031dc155c0be856ae383e0ba7e",
      price: SAFEEXIT_X402_PRICE,
    });
    expect(createSafeExitX402RouteConfig(configuration).accepts).toMatchObject({
      scheme: "exact",
      network: "eip155:196",
      price: "$0.10",
    });
  });

  it("refuses to expose a paid endpoint with incomplete credentials", () => {
    const environment = parseDeploymentEnvironment({
      NODE_ENV: "production",
      SAFEEXIT_X402_MODE: "MAINNET",
      SAFEEXIT_X402_PAY_TO_ADDRESS: "0x4ab2b4be420a82031dc155c0be856ae383e0ba7e",
    });
    expect(() => getSafeExitX402Configuration(environment)).toThrow(
      "configuration is incomplete",
    );
  });

  it("rejects malformed payout addresses", () => {
    expect(() =>
      parseDeploymentEnvironment({
        NODE_ENV: "production",
        SAFEEXIT_X402_MODE: "MAINNET",
        SAFEEXIT_X402_PAY_TO_ADDRESS: "0xnot-an-address",
      }),
    ).toThrow();
  });
});
