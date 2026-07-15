import { evmAddressSchema, type EvmAddress } from "@safeexit/shared";

export const PERMIT_SETTLEMENT_NAME = "SafeExit Permit Settlement";
export const PERMIT_SETTLEMENT_VERSION = "2";
export const PERMIT_KIND_ERC2612 = 1;
export const PERMIT_KIND_DAI = 2;

export const ERC20_RESCUE_TYPEHASH =
  "0xdf59f33dd4143df49a477bacb625cde06b6a022031985be27ddf2a1d01df2059";
export const ERC721_RESCUE_TYPEHASH =
  "0xc8c5f2f27df3d275d82978fa06e4b58b1efd6eec9c83f8786baf5a82269ff793";

const permitSettlementDeployments: Readonly<Partial<Record<number, Readonly<{
  address: EvmAddress;
  expectedRuntimeHash: `0x${string}`;
}>>>> = {
  196: {
    address: evmAddressSchema.parse("0x73E8A8d165EC9710aC27f91B0Df02975CC4a48d0"),
    expectedRuntimeHash: "0x955c4b306894721c464f129075049c055ba9da3688cf5e538cf5eb90c0cbd3de",
  },
};

export function getConfiguredPermitSettlementAddress(
  chainId: number,
): EvmAddress | undefined {
  return permitSettlementDeployments[chainId]?.address;
}

export function getConfiguredPermitSettlementRuntimeHash(
  chainId: number,
): `0x${string}` | undefined {
  return permitSettlementDeployments[chainId]?.expectedRuntimeHash;
}

export const permitSettlementDomainTypes = [
  { name: "name", type: "string" },
  { name: "version", type: "string" },
  { name: "chainId", type: "uint256" },
  { name: "verifyingContract", type: "address" },
] as const;

export const erc20RescueTypes = {
  ERC20Rescue: [
    { name: "token", type: "address" },
    { name: "owner", type: "address" },
    { name: "destination", type: "address" },
    { name: "amount", type: "uint256" },
    { name: "permitNonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
    { name: "rescueNonce", type: "bytes32" },
    { name: "permitKind", type: "uint8" },
  ],
} as const;

export const erc721RescueTypes = {
  ERC721Rescue: [
    { name: "collection", type: "address" },
    { name: "owner", type: "address" },
    { name: "destination", type: "address" },
    { name: "tokenId", type: "uint256" },
    { name: "permitNonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
    { name: "rescueNonce", type: "bytes32" },
  ],
} as const;

const signatureComponents = [
  {
    name: "permitSignature",
    type: "tuple",
    components: [
      { name: "v", type: "uint8" },
      { name: "r", type: "bytes32" },
      { name: "s", type: "bytes32" },
    ],
  },
  {
    name: "rescueSignature",
    type: "tuple",
    components: [
      { name: "v", type: "uint8" },
      { name: "r", type: "bytes32" },
      { name: "s", type: "bytes32" },
    ],
  },
] as const;

export const permitSettlementAbi = [
  {
    type: "function",
    name: "settleERC2612",
    stateMutability: "nonpayable",
    inputs: [
      { name: "token", type: "address" },
      { name: "owner", type: "address" },
      { name: "destination", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "permitNonce", type: "uint256" },
      { name: "deadline", type: "uint256" },
      { name: "rescueNonce", type: "bytes32" },
      ...signatureComponents,
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "settleDaiPermit",
    stateMutability: "nonpayable",
    inputs: [
      { name: "token", type: "address" },
      { name: "holder", type: "address" },
      { name: "destination", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "allowNonce", type: "uint256" },
      { name: "expiry", type: "uint256" },
      { name: "rescueNonce", type: "bytes32" },
      { ...signatureComponents[0], name: "allowSignature" },
      { ...signatureComponents[0], name: "revokeSignature" },
      signatureComponents[1],
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "settleERC4494",
    stateMutability: "nonpayable",
    inputs: [
      { name: "collection", type: "address" },
      { name: "owner", type: "address" },
      { name: "destination", type: "address" },
      { name: "tokenId", type: "uint256" },
      { name: "permitNonce", type: "uint256" },
      { name: "deadline", type: "uint256" },
      { name: "rescueNonce", type: "bytes32" },
      { name: "permitSignature", type: "bytes" },
      signatureComponents[1],
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "eip712Domain",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "fields", type: "bytes1" },
      { name: "name", type: "string" },
      { name: "version", type: "string" },
      { name: "chainId", type: "uint256" },
      { name: "verifyingContract", type: "address" },
      { name: "salt", type: "bytes32" },
      { name: "extensions", type: "uint256[]" },
    ],
  },
  {
    type: "function",
    name: "PERMIT_KIND_ERC2612",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
  {
    type: "function",
    name: "PERMIT_KIND_DAI",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
  {
    type: "function",
    name: "ERC20_RESCUE_TYPEHASH",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "bytes32" }],
  },
  {
    type: "function",
    name: "ERC721_RESCUE_TYPEHASH",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "bytes32" }],
  },
] as const;
