# SAFEEXIT Threat Model

## Protected assets

- Source-wallet assets and short-lived EIP-712 authorizations.
- The integrity of the safe destination, chain, asset, amount, and token ID.
- OKX API credentials, the agent bearer key, RPC credentials, and database URL.
- x402 payments and the provider payout address.
- Incident address and asset-manifest privacy.

## Adversaries

- An attacker who already knows the source private key and races the owner.
- A malicious API caller attempting destination or action substitution.
- A malicious or non-standard token contract.
- A compromised RPC response, browser page, dependency, or wallet provider.
- An attacker attempting replay, stale-state execution, payment abuse, denial of
  service, credential leakage, or false completion reports.

## Trust boundaries

1. User input enters strict Zod schemas and never becomes arbitrary calldata.
2. Server-side RPC reads produce a block-pinned scan, deterministic plan, and
   simulation result.
3. The browser or buyer-local runtime receives only allowlisted EIP-712 signing
   requests and constructs calls from code-owned ABIs.
4. The source wallet signs locally. Signatures never cross into SAFEEXIT APIs,
   logs, or persistence.
5. The destination wallet must match the committed address and chain, reports
   EIP-5792 atomic support when required, and pays gas.
6. SAFEEXIT accepts only receipt metadata back from the buyer runtime and
   independently checks successful receipts for the committed transfer event.

## Principal threats and controls

| Threat | Control |
| --- | --- |
| Destination substitution | Destination is repeated in UI, fixed in plan/package schemas, included in typed data, rechecked after network changes and immediately before submission. |
| Cross-chain replay | Chain ID and verifying contract are verified against the token domain and committed package. Production accepts chain `196` only. |
| Signature replay | ERC-3009 random nonces, permit nonces, and short expiries; current nonce/state is read before signing. |
| Arbitrary AI execution | AI is explanation-only and cannot author calldata or alter deterministic actions. |
| Partial permit batch | Permit routes require EIP-5792 atomic execution; unsupported wallets fail closed. |
| Route change after scan | Fresh preflight must still contain the exact reviewed action-and-standard key. |
| False success | Browser and hosted verifier require the exact asset contract `Transfer` event from source to destination with the committed amount or token ID. |
| Account switch race | Active account and chain are re-read after switching and again after simulation/before submission. |
| Secret leakage | Credentials are server-only; schemas reject line breaks; logs redact secret fields, bearer material, and URLs. |
| API abuse | Strict payload limits, shared fail-closed rate limits, bearer authentication, no-store responses, and x402 throttling before payment handling. |

## Residual risks

- Recovery cannot be guaranteed when the attacker has the same private key.
- The official public X Layer RPC does not currently expose `eth_simulateV1`.
  The browser therefore verifies the signed permit call, relies on EIP-5792
  atomicity for multi-call execution, and verifies the exact transfer receipt.
  The buyer runtime requires a full sequential simulation provider and fails
  closed when one is unavailable.
- A malicious token may violate ERC semantics or emit deceptive events. Support
  is best effort and restricted to capability-verified routes.
- Source signatures exist briefly in browser memory and remain exposed to a
  compromised browser, operating system, or extension.
- The production CSP still permits inline scripts for Next.js compatibility.
  This increases the importance of dependency control and avoiding all unsafe
  HTML rendering.
- Incident URLs act as high-entropy bearer links and reveal public wallet data
  to anyone who receives the link.
- No software audit can certify that funds are safe or replace a low-value,
  operator-owned canary and an incident-response plan.

