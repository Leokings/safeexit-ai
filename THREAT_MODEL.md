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
   the exact settlement-contract call, and pays gas.
6. SAFEEXIT accepts only receipt metadata back from the buyer runtime and
   independently checks successful receipts for the committed transfer event,
   chain-specific confirmation depth, canonical block hash, and final asset state.

## Principal threats and controls

| Threat | Control |
| --- | --- |
| Destination substitution | Destination is repeated in UI, fixed in plan/package schemas, included in typed data, rechecked after network changes and immediately before submission. |
| Cross-chain replay | Chain ID and verifying contract are verified against the token domain and committed package. Production accepts only the eight code-owned rescue-chain IDs and rechecks the active wallet chain before submission. |
| Signature replay | ERC-3009 random nonces, permit nonces, and short expiries; current nonce/state is read before signing. |
| Arbitrary AI execution | AI is explanation-only and cannot author calldata or alter deterministic actions. |
| Partial permit execution | Permit, transfer, and revocation execute inside one settlement-contract transaction; any failure reverts the whole transaction. |
| Route change after scan | Fresh preflight must still contain the exact reviewed action-and-standard key. |
| False success or receipt reorg | Browser and hosted verifier require the exact asset contract `Transfer` event from source to destination with the committed amount or token ID. Completion also requires a chain-specific confirmation hold, a canonical receipt block, and a second canonicality check after final asset-state reads. |
| Preflight response substitution | Plan integrity, scan/block identity, simulations, route source/destination/asset/value, EIP-712 domain, and configured settlement deployment are independently cross-checked before signing. |
| Missing chain infrastructure | Production readiness requires a dedicated HTTPS RPC with the expected chain ID and deterministic read support for all eight advertised mainnets. |
| Account switch race | Active account and chain are re-read after switching and again after simulation/before submission. |
| Secret leakage | Credentials are server-only; schemas reject line breaks; logs redact secret fields, bearer material, and URLs. |
| API abuse | Strict payload limits, shared fail-closed rate limits, bearer authentication, no-store responses, and x402 throttling before payment handling. |
| Arbitrary EIP-7702 delegated control | The implementation-under-test has no arbitrary-call entry point. A CREATE2-deployed incident delegate immutably binds chain, source, destination, expiry, plan hash, and rescue nonce and accepts only six structured action kinds. |
| Delegated initialization front-run | No mutable initialization exists. The signed delegate address commits to constructor arguments and runtime immutables before the source signs an authorization. |
| One missing asset blocks every rescue | The committed plan is immutable, but the destination may execute strictly ordered action subsets. Each action has isolated replay state so a missing asset can fail without consuming or blocking another action. |
| Persistent EIP-7702 delegation | A chain-bound clearing authorization is prepared for the next source nonce. Production activation requires a confirmed canonical clear receipt and a private submission policy; a failed type-4 execution does not itself remove delegation. |
| Local signer credential exposure | The EIP-7702 runtime accepts only an in-process signer interface. Package schemas reject credential fields, authorizations live in one-use `WeakMap` handles, and no source authorization is returned to SAFEEXIT APIs or persistence. |
| Malicious factory substitution | The buyer runtime requires a separately pinned factory address and runtime hash. It rejects a package even when the server substitutes both its claimed factory and matching claimed hash. |
| Cleanup skipped after partial failure | Once the destination submits a transaction carrying the delegation authorization, the runtime queues the nonce-consecutive clearing transaction even if receipt polling or a later isolated rescue action fails. |

## Residual risks

- Recovery cannot be guaranteed when the attacker has the same private key.
- An attacker holding that key can sign a competing EIP-7702 authorization or
  invalidate the expected source nonce. The incident-bound delegate prevents
  its own calls from redirecting assets, but it cannot solve the underlying
  ownership race. The buyer-local runtime reduces the signing boundary but does
  not remove this race. The hosted EIP-7702 route therefore remains
  non-executable.
- Public RPC simulation capabilities vary by chain; the official public X Layer
  RPC does not currently expose `eth_simulateV1`. The browser uses `eth_call`
  to preflight the exact signed settlement-contract transaction and verifies
  the exact transfer receipt. The buyer runtime requires an exact-call
  simulation provider and fails closed when one is unavailable.
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
