# SAFEEXIT Multichain Adapter Verification

## Status

- Verification date: 2026-07-15
- Networks: Ethereum `1`, BNB Smart Chain `56`, Polygon `137`, Arbitrum One
  `42161`, Optimism `10`, Base `8453`, Avalanche C-Chain `43114`, and X Layer
  `196`
- Classification: internal engineering verification, not an independent audit
  or a guarantee that a particular asset is recoverable

All eight network adapters are enabled only when their server-side HTTPS RPC is
present and passes the production readiness probe. The probe verifies the
reported chain ID and deterministic, block-pinned EVM reads for the latest
block, native balance, transaction count, bytecode, and `eth_call`.

## Verified adapter surface

| Network | Chain ID | Scanner and preflight | Local signing | Settlement contract |
| --- | ---: | --- | --- | --- |
| Ethereum | 1 | Enabled | Chain-bound EIP-712 | Verified deployment |
| BNB Smart Chain | 56 | Enabled | Chain-bound EIP-712 | Verified deployment |
| Polygon | 137 | Enabled | Chain-bound EIP-712 | Verified deployment |
| Arbitrum One | 42161 | Enabled | Chain-bound EIP-712 | Verified deployment |
| Optimism | 10 | Enabled | Chain-bound EIP-712 | Verified deployment |
| Base | 8453 | Enabled | Chain-bound EIP-712 | Verified deployment |
| Avalanche C-Chain | 43114 | Enabled | Chain-bound EIP-712 | Verified deployment |
| X Layer | 196 | Enabled | Chain-bound EIP-712 | Verified deployment |

The selected incident chain is committed through scanning, planning, preflight,
EIP-712 authorization, wallet network switching, submission, and receipt
verification. Responses that report a different chain fail closed.

## Settlement deployment verification

`SafeExitPermitSettlementV2` is deployed at the deterministic address
`0x73E8A8d165EC9710aC27f91B0Df02975CC4a48d0` on all eight networks. The
canonical CREATE2 factory, fixed deployment payload, zero transaction value,
shared immutable template hash, chain-specific runtime hash, EIP-712 domain,
and public contract constants were verified onchain.

| Network | Runtime hash |
| --- | --- |
| Ethereum | `0x1183e94093ad7baf0606bef1755bd56930c1eec1d7a9db4102eac03663bb54cd` |
| BNB Smart Chain | `0xd2c64850be4dcb4948925247b5b11be584f650cf0f5bf2402dbc690cbe4c12b1` |
| Polygon | `0x70baaa06eaac1bb6813d9317e4b04502bdea3a54c4791a5e9d01106458f346f5` |
| Arbitrum One | `0xa5545da519187ecd09cb14d9f814ca467dd361d086775e4cbf8b3ff05c723611` |
| Optimism | `0xdd90cd4be84e1aedc9d16a9da8bdf6caa040dda8b2b9f312c433caf6be1ade55` |
| Base | `0x69ef1ca11c2d4a0bcd0defb53c988d31c1027c0b89afb9bc5317b533de97aa45` |
| Avalanche C-Chain | `0xc3cff642b325f9bef6408b3d17bc6dc4be3b75213eebe58b47e8dadf1ad78de8` |
| X Layer | `0x955c4b306894721c464f129075049c055ba9da3688cf5e538cf5eb90c0cbd3de` |

The shared immutable template hash is
`0x7541ad91f5820c9dc006d552d12da784203a41920f0405a1ed3edc773b3ab889`.
Exact deployment receipts are retained in `contracts/deployments` and listed in
`contracts/README.md`.

## Asset-route limits

Network support does not imply universal token support. SAFEEXIT detects each
asset's available route at the incident block and only presents a route when
the token contract and wallet capabilities satisfy its deterministic checks.
The current destination-paid routes are:

- ERC-3009 direct settlement;
- ERC-2612 permit plus atomic transfer;
- DAI-style permit plus atomic transfer; and
- ERC-4494 permit plus atomic NFT transfer.

Settlement routes additionally require the destination wallet to report the
verified SAFEEXIT permit settlement contract for the selected chain. On the
seven non-X Layer mainnets, native currency, ERC-1155 assets, non-permit
tokens, protocol claims, protocol withdrawals, EIP-7702, and private bundles
remain non-executable. X Layer V2 EIP-7702 is a separately reviewed adapter
and is not evidence supplied by this multichain permit-settlement verification.

## Boundaries

- The x402 service fee remains settled on X Layer and is independent of the
  chain selected for the rescue incident.
- Private RPC credentials stay server-side and are redacted from logs.
- Source signatures remain local to the user's wallet or buyer runtime.
- No user-asset authorization, settlement, or transfer was performed as part
  of this verification. Only the fixed settlement-contract deployment
  transactions were broadcast.
- OKX documents Wallet API and Agentic Wallet support for the selected networks,
  but third-party wallets and token contracts remain external trust boundaries.

## Reproduction

Run the repository checks, then inspect the deployed readiness endpoint:

```text
npm run ci
npm run contracts:verify:settlement:all
curl https://safeexit.xyz/api/ready
```

An enabled adapter reports
`connected:<chainId>:<latestBlock>:ENABLED`. A missing, mismatched, or
incompatible RPC makes readiness fail instead of silently degrading.
