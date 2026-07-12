import { createHmac } from "node:crypto";

import { z } from "zod";

import { evmAddressSchema, type EvmAddress } from "@safeexit/shared";

const okxCredentialsSchema = z.strictObject({
  apiKey: z.string().min(1),
  secretKey: z.string().min(1),
  passphrase: z.string().min(1),
});

const okxTokenAssetSchema = z.strictObject({
  chainIndex: z.string().regex(/^\d+$/),
  tokenContractAddress: z.string(),
  address: evmAddressSchema,
  symbol: z.string().min(1).max(64),
  balance: z.string().min(1),
  rawBalance: z.string(),
  tokenPrice: z.string(),
  isRiskToken: z.boolean(),
});

const okxBalanceResponseSchema = z.strictObject({
  code: z.string(),
  msg: z.string(),
  data: z.array(
    z.strictObject({
      tokenAssets: z.array(okxTokenAssetSchema),
    }),
  ),
});

export type OkxWalletApiCredentials = z.infer<typeof okxCredentialsSchema>;

export type OkxDiscoveredToken = {
  chainId: number;
  tokenAddress: EvmAddress;
  ownerAddress: EvmAddress;
  symbol: string;
  displayBalance: string;
  rawBalance?: string;
  tokenPriceUsd?: number;
};

export type OkxWalletApiRequest = {
  url: string;
  headers: Readonly<Record<string, string>>;
};

export type OkxWalletApiTransport = (
  request: OkxWalletApiRequest,
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export const OKX_TOTAL_TOKEN_BALANCES_PATH =
  "/api/v6/dex/balance/all-token-balances-by-address";

export function createOkxAccessSignature(
  timestamp: string,
  method: "GET" | "POST",
  requestPathWithQuery: string,
  secretKey: string,
  body = "",
): string {
  return createHmac("sha256", secretKey)
    .update(`${timestamp}${method}${requestPathWithQuery}${body}`)
    .digest("base64");
}

function optionalPrice(value: string): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

export class OkxWalletBalanceDiscoveryClient {
  private readonly credentials: OkxWalletApiCredentials;

  constructor(
    credentials: OkxWalletApiCredentials,
    private readonly transport: OkxWalletApiTransport,
    private readonly clock: () => Date = () => new Date(),
    private readonly baseUrl = "https://web3.okx.com",
  ) {
    this.credentials = okxCredentialsSchema.parse(credentials);
  }

  async discoverErc20Tokens(
    address: EvmAddress,
    chainId: number,
  ): Promise<readonly OkxDiscoveredToken[]> {
    const ownerAddress = evmAddressSchema.parse(address);
    const query = new URLSearchParams({
      address: ownerAddress,
      chains: String(chainId),
      excludeRiskToken: "0",
    });
    const requestPath = `${OKX_TOTAL_TOKEN_BALANCES_PATH}?${query.toString()}`;
    const timestamp = this.clock().toISOString();
    const signature = createOkxAccessSignature(
      timestamp,
      "GET",
      requestPath,
      this.credentials.secretKey,
    );
    const response = await this.transport({
      url: new URL(requestPath, this.baseUrl).toString(),
      headers: {
        Accept: "application/json",
        "OK-ACCESS-KEY": this.credentials.apiKey,
        "OK-ACCESS-PASSPHRASE": this.credentials.passphrase,
        "OK-ACCESS-SIGN": signature,
        "OK-ACCESS-TIMESTAMP": timestamp,
      },
    });

    if (!response.ok) {
      throw new Error(`OKX Wallet API request failed with HTTP ${response.status}`);
    }
    const payload = okxBalanceResponseSchema.parse(await response.json());
    if (payload.code !== "0") {
      throw new Error(`OKX Wallet API rejected the request: ${payload.msg || payload.code}`);
    }

    const candidates = payload.data.flatMap((entry) => entry.tokenAssets);
    return candidates.flatMap((asset) => {
      if (
        asset.chainIndex !== String(chainId) ||
        asset.isRiskToken ||
        asset.tokenContractAddress === ""
      ) {
        return [];
      }
      const tokenAddress = evmAddressSchema.safeParse(asset.tokenContractAddress);
      if (!tokenAddress.success || asset.address.toLowerCase() !== ownerAddress.toLowerCase()) {
        return [];
      }
      const tokenPriceUsd = optionalPrice(asset.tokenPrice);
      return [
        {
          chainId,
          tokenAddress: tokenAddress.data,
          ownerAddress,
          symbol: asset.symbol,
          displayBalance: asset.balance,
          ...(asset.rawBalance ? { rawBalance: asset.rawBalance } : {}),
          ...(tokenPriceUsd !== undefined ? { tokenPriceUsd } : {}),
        },
      ];
    });
  }
}
