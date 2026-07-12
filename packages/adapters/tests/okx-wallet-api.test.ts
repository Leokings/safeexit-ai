import { describe, expect, it, vi } from "vitest";

import {
  OKX_TOTAL_TOKEN_BALANCES_PATH,
  OkxWalletBalanceDiscoveryClient,
  createOkxAccessSignature,
} from "../src";

const owner = "0x1111111111111111111111111111111111111111" as const;
const token = "0x2222222222222222222222222222222222222222" as const;

describe("OKX Wallet balance discovery", () => {
  it("creates the documented HMAC-SHA256 base64 signature", () => {
    expect(
      createOkxAccessSignature(
        "2026-07-12T12:00:00.000Z",
        "GET",
        "/api/v6/test?chain=196",
        "secret",
      ),
    ).toBe("B5glir9y5pjmb5t6F9RHf3gVu2qAmtziRbRelYmZUg8=");
  });

  it("returns only non-risk ERC-20 candidates for the requested owner and chain", async () => {
    const transport = vi.fn(async () => ({
      ok: true,
      status: 200,
      async json() {
        return {
          code: "0",
          msg: "success",
          data: [
            {
              tokenAssets: [
                {
                  chainIndex: "196",
                  tokenContractAddress: token,
                  address: owner,
                  symbol: "SAFE",
                  balance: "12.5",
                  rawBalance: "12500000",
                  tokenPrice: "1.25",
                  isRiskToken: false,
                },
                {
                  chainIndex: "196",
                  tokenContractAddress: "",
                  address: owner,
                  symbol: "OKB",
                  balance: "1",
                  rawBalance: "1000000000000000000",
                  tokenPrice: "50",
                  isRiskToken: false,
                },
                {
                  chainIndex: "196",
                  tokenContractAddress: "0x3333333333333333333333333333333333333333",
                  address: owner,
                  symbol: "RISK",
                  balance: "1",
                  rawBalance: "1",
                  tokenPrice: "0",
                  isRiskToken: true,
                },
              ],
            },
          ],
        };
      },
    }));
    const client = new OkxWalletBalanceDiscoveryClient(
      { apiKey: "key", secretKey: "secret", passphrase: "passphrase" },
      transport,
      () => new Date("2026-07-12T12:00:00.000Z"),
    );

    await expect(client.discoverErc20Tokens(owner, 196)).resolves.toEqual([
      {
        chainId: 196,
        tokenAddress: token,
        ownerAddress: owner,
        symbol: "SAFE",
        displayBalance: "12.5",
        rawBalance: "12500000",
        tokenPriceUsd: 1.25,
      },
    ]);
    const request = transport.mock.calls[0]?.[0];
    expect(request?.url).toContain(OKX_TOTAL_TOKEN_BALANCES_PATH);
    expect(request?.url).toContain("chains=196");
    expect(request?.headers["OK-ACCESS-KEY"]).toBe("key");
    expect(request?.headers["OK-ACCESS-SIGN"]).not.toContain("secret");
  });

  it("rejects non-success OKX business responses", async () => {
    const client = new OkxWalletBalanceDiscoveryClient(
      { apiKey: "key", secretKey: "secret", passphrase: "passphrase" },
      async () => ({
        ok: true,
        status: 200,
        async json() {
          return { code: "50113", msg: "Invalid signature", data: [] };
        },
      }),
    );

    await expect(client.discoverErc20Tokens(owner, 196)).rejects.toThrow(
      "OKX Wallet API rejected the request",
    );
  });
});
