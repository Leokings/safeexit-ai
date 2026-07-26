import { getAddress, type Hex } from "viem";

export type TrustedEip7702Factory = Readonly<{
  chainId: 196;
  address: `0x${string}`;
  runtimeHash: Hex;
}>;

export const XLAYER_SAFEEXIT_EIP7702_FACTORY_V2 =
  Object.freeze<TrustedEip7702Factory>({
    chainId: 196,
    address: getAddress("0x115C0340040C68bDc68E1890DA984575E49814e5"),
    runtimeHash:
      "0x0f8beb374fbb87b0a1100b2c25dd649d897a76da1563e8b6cd885a24ac34dc7f",
  });
