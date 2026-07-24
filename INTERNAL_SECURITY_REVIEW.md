# SAFEEXIT Internal Security Review

## Status

- Review date: 2026-07-15
- Baseline: `cea127495a692dab372186a3b6239e00bfa9787f`
- Reviewer: OpenAI Codex, also involved in implementation
- Classification: internal engineering review, not an independent audit or a
  guarantee of fund safety

The review covered the X Layer mainnet destination-paid recovery path, hosted
agent APIs, local buyer runtime, x402 boundary, persistence, deployment
configuration, browser security boundary, and the subsequently added
`SafeExitPermitSettlement` contract. This remains an internal implementation
review, not an independent contract audit.

The production settlement is now `SafeExitPermitSettlementV2` at
`0x73E8A8d165EC9710aC27f91B0Df02975CC4a48d0`. The original v1 deployment is
retained only for reproducibility and is no longer selected by production
adapters.

This review predates the eight-network adapter expansion. The multichain release
preserves the reviewed authorization and settlement invariants and is recorded
separately in `MULTICHAIN_ADAPTER_VERIFICATION.md`; that internal verification
does not widen this review into an independent audit.

The later EIP-7702 delegate, factory, buyer-local signer, and destination-paid
runtime implementation are also not approved by this review. Their delegated
context, strict-package, signer-recovery, partial-action, cleanup-fallback, and
type-4 serialization tests are useful engineering evidence, but the route
remains `executable: false` pending the activation gates recorded in
`DEPLOYMENT.md` and the dedicated scope in `AUDIT_SCOPE.md`.

## Resolved findings

| ID | Severity | Finding | Resolution |
| --- | --- | --- | --- |
| SE-01 | High | Browser receipt success was treated as transfer success without proving the committed asset moved. A token returning `false` could create a false-positive completion. | Browser now requires an exact `Transfer` event from the committed source to destination for the exact amount or token ID. |
| SE-02 | High | A fresh preflight could silently fall back to the first route if the route reviewed by the user disappeared. | Signing now fails closed until the user reviews and explicitly selects a route from the fresh result. |
| SE-03 | Medium | The UI read the active account before switching to X Layer and reused it; the buyer runtime did not recheck account/chain after simulation. | Account and chain are re-read after switching and immediately before submission. |
| SE-04 | Medium | EIP-5792 submission parsing accepted only a legacy string, while the standard response is `{ "id": "..." }`. | The wallet-batch execution path was removed. Permit routes now submit one fixed settlement-contract transaction. |
| SE-05 | Medium | Secure logging redacted structured secrets but could preserve a credential-bearing RPC URL inside an error message. | Error strings now redact HTTP(S) URLs, bearer values, and OKX access headers. |
| SE-06 | Low | Obsolete local demo contracts, attacker scripts, and public Anvil keys remained in the repository even though they were not deployed. | The contract/demo directories, scripts, commands, and unused OpenZeppelin dependency were removed. |
| SE-07 | Low | Security-critical x402 dependencies used semver ranges. | Installed OKX x402 versions are now exactly pinned in `package.json` and the lockfile. |
| SE-08 | Low | Environment schemas allowed malformed RPC/credential strings to reach runtime checks. | RPCs must be exact HTTPS URLs; server credentials reject line breaks. |
| SE-09 | Medium | V1 rejected an otherwise valid rescue when an observer submitted the ERC-2612 or DAI allow permit before settlement. | V2 accepts only the narrowly proven pre-consumed state: the nonce advanced exactly once and the settlement allowance still supports the signed rescue. Unrelated nonce or allowance changes fail closed. |
| SE-10 | Medium | The browser preflight parser accepted signing-domain and settlement fields without independently tying every route to the plan, successful simulation, and chain-pinned settlement deployment. | The response boundary now verifies plan integrity and exact scan, action, simulation, source, destination, asset, amount/token ID, domain, and configured deployment commitments. Permit builders independently reject unconfigured settlement contracts before signing. |
| SE-11 | Medium | A first successful receipt could complete a rescue without a chain-specific confirmation hold or proof that its block remained canonical. | Browser and buyer-runtime settlement now wait for explicit per-chain confirmation thresholds. The hosted verifier checks confirmation depth and canonical block hash before evidence checks and rechecks the same canonical anchor after final asset-state reads. Reorged or under-confirmed receipts remain pending. |
| SE-12 | Low | Production readiness silently skipped missing mainnet RPC variables even though all eight chains were advertised as enabled. | Production readiness now requires and probes dedicated HTTPS RPCs for every advertised rescue mainnet, including chain identity and deterministic EVM reads. |

## Verification performed

- Manual review against ERC-2612, ERC-3009, ERC-4494, and EIP-712
  authorization requirements.
- Targeted adversarial unit tests for route substitution, account switching,
  destination substitution, false transfer evidence, simulation failure,
  unpinned deployments, cross-chain signing domains, stale plan/simulation
  commitments, receipt reorgs, insufficient confirmations, and log leakage.
- Seventeen Solidity tests covering v1 reproducibility plus v2 replay,
  destination binding, expiry, amount substitution, pre-consumed permits,
  stale nonces, fee-on-transfer rejection, allowance revocation, and atomic
  rollback, and one shared-deployment mixed ERC-2612/ERC-4494 rescue.
- Full lint, TypeScript, Vitest, Prisma, and Next.js production build through
  `npm run ci`.
- `npm audit --omit=dev`, registry signature verification, secret-pattern scan,
  and dependency inventory.
- Read-only X Layer RPC capability probe. No live source signature or asset
  transfer was produced during this review.

## Accepted and open risk

1. This review is not independent because the reviewer also helped implement
   the system. SAFEEXIT must not be represented as independently audited. An
   external review remains a future risk-reduction milestone, not a runtime
   asset-value restriction.
2. The public X Layer RPC rejects `eth_simulateV1`. Browser settlement uses
   `eth_call` against the exact signed, single-call transaction instead.
   Settlement-contract identity, exact signed-call preflight, and receipt
   evidence mitigate provider and token risk but cannot eliminate it.
3. The production CSP includes `'unsafe-inline'` for Next.js compatibility.
   There is no unsafe HTML rendering in the reviewed tree, but browser-side
   signature memory makes future XSS regressions high impact.
4. Native OKB, ERC-1155 settlement, protocol claims, withdrawals, EIP-7702, and
   private bundles remain blocked and were not approved by this review.
5. A malicious or severely non-standard asset contract can violate expected
   token semantics. SAFEEXIT is best effort, not universal recovery.

## Release recommendation

Do not label this release independently audited. Enable every deterministically
verified and freshly simulated supported route without an arbitrary monetary
cap, retain fail-closed behavior for unsupported routes, and perform an
operator-owned mainnet canary when introducing a new adapter or token behavior.
Use `AUDIT_SCOPE.md` when an external review becomes practical and publish any
future report with its exact remediation commit.
