# SAFEEXIT Multichain Adapter Verification

## Status

- Verification date: 2026-07-14
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

| Network | Chain ID | Scanner and preflight | Local signing | Settlement |
| --- | ---: | --- | --- | --- |
| Ethereum | 1 | Enabled | Chain-bound EIP-712 | Capability-gated |
| BNB Smart Chain | 56 | Enabled | Chain-bound EIP-712 | Capability-gated |
| Polygon | 137 | Enabled | Chain-bound EIP-712 | Capability-gated |
| Arbitrum One | 42161 | Enabled | Chain-bound EIP-712 | Capability-gated |
| Optimism | 10 | Enabled | Chain-bound EIP-712 | Capability-gated |
| Base | 8453 | Enabled | Chain-bound EIP-712 | Capability-gated |
| Avalanche C-Chain | 43114 | Enabled | Chain-bound EIP-712 | Capability-gated |
| X Layer | 196 | Enabled | Chain-bound EIP-712 | Capability-gated |

The selected incident chain is committed through scanning, planning, preflight,
EIP-712 authorization, wallet network switching, submission, and receipt
verification. Responses that report a different chain fail closed.

## Asset-route limits

Network support does not imply universal token support. SAFEEXIT detects each
asset's available route at the incident block and only presents a route when
the token contract and wallet capabilities satisfy its deterministic checks.
The current destination-paid routes are:

- ERC-3009 direct settlement;
- ERC-2612 permit plus atomic transfer;
- DAI-style permit plus atomic transfer; and
- ERC-4494 permit plus atomic NFT transfer.

Multi-call routes additionally require the destination wallet to report
the verified SAFEEXIT permit settlement contract for the selected chain. Native currency,
ERC-1155 assets, non-permit tokens, protocol claims, protocol withdrawals,
EIP-7702, and private bundles remain non-executable.

## Boundaries

- The x402 service fee remains settled on X Layer and is independent of the
  chain selected for the rescue incident.
- Private RPC credentials stay server-side and are redacted from logs.
- Source signatures remain local to the user's wallet or buyer runtime.
- No live authorization, settlement, or asset transfer was performed as part
  of this verification.
- OKX documents Wallet API and Agentic Wallet support for the selected networks,
  but third-party wallets and token contracts remain external trust boundaries.

## Reproduction

Run the repository checks, then inspect the deployed readiness endpoint:

```text
npm ci
npm run ci
curl https://safeexit.xyz/api/ready
```

An enabled adapter reports
`connected:<chainId>:<latestBlock>:ENABLED`. A missing, mismatched, or
incompatible RPC makes readiness fail instead of silently degrading.
