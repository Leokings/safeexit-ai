# SAFEEXIT Internal Security Review

## Status

- Review date: 2026-07-15
- EIP-7702 follow-up review: 2026-07-26
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

The later X Layer V2 EIP-7702 delegate, factory, buyer runtime, temporary payer,
Source Signer extension, and hosted execution path received a follow-up
internal review on 2026-07-26. The review includes delegated context,
strict-package commitments, source recovery, partial-action isolation,
cleanup fallback, type-4 serialization, production manifest scope, and
mainnet execution evidence. It remains an internal review, not an independent
audit.

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
| SE-13 | High | The Source Signer pinned factory metadata but did not independently prove that the requested delegate address was produced by that factory. A compromised allowed page could obtain an authorization for unrelated delegate code and bypass the normal runtime. | Before staging a review, the extension now checks the pinned V2 factory bytecode and `predictDelegate` result through both exact official X Layer RPC endpoints. Any mismatch or unavailable quorum fails closed. |
| SE-14 | Medium | The signing-package schema allowed more committed actions than execution indexes. The official builder selected every action, but another producer could create additional authorized actions outside the runtime's displayed execution selection. | Schema validation now requires action IDs, simulations, actions, and execution indexes to have equal length and requires indexes to cover the complete plan in order. |
| SE-15 | Medium | A receipt provider failure during clearing could be reported as uncleared even when canonical source code and nonce proved clearing succeeded. That false negative could encourage a dangerous retry. | Clearing now treats canonical empty source code plus the nonce-consecutive advance as authoritative after any receipt error and fails only when that postcondition is absent. |
| SE-16 | Medium | `fundGasBudget` relied on its caller to pass the calculated cap. Direct use could fund a temporary payer outside the intended minimum/maximum policy. | The funding method now independently rejects values outside the fixed `0.0001` to `0.005` native-unit budget before touching a provider. |
| SE-17 | Medium | The production extension manifest included localhost origins, unnecessarily widening the signing surface. | Production now matches only `https://safeexit.xyz`; localhost exists only in an explicit development manifest and build command. |
| SE-18 | Low | Refund failure could overwrite a successful rescue result, and hashes attached to an execution exception were all labeled failed even when some transfers may have confirmed. | Rescue results are recorded before refund warnings, and uncertain submitted hashes are displayed as unresolved rather than falsely failed. |
| SE-19 | Low | The obsolete V1 factory remained exported beside V2 and stale documentation described the active route as disabled or destination-only. | The V1 trust constant was removed from public runtime exports, and deployment, scope, threat-model, extension, and evidence documents now describe the fixed-recipient temporary-payer V2 route. |

## Verification performed

- Manual review against ERC-2612, ERC-3009, ERC-4494, and EIP-712
  authorization requirements.
- Targeted adversarial unit tests for route substitution, account switching,
  destination substitution, false transfer evidence, simulation failure,
  unpinned deployments, cross-chain signing domains, stale plan/simulation
  commitments, receipt reorgs, insufficient confirmations, and log leakage.
- Twenty-three Solidity tests covering the V2 EIP-7702 delegate, factory
  idempotency, partial-action isolation, clearing prerequisites, v1
  reproducibility, and v2 permit-settlement replay, destination binding,
  expiry, amount substitution, pre-consumed permits, stale nonces,
  fee-on-transfer rejection, allowance revocation, atomic rollback, and a
  shared-deployment mixed ERC-2612/ERC-4494 rescue.
- Full lint, TypeScript, Vitest, Prisma, and Next.js production build through
  `npm run ci`.
- `npm audit --omit=dev`, registry signature verification, secret-pattern scan,
  and dependency inventory.
- Read-only X Layer RPC capability probe. No live source signature or asset
  transfer was produced during this review.
- Focused EIP-7702 verification on 2026-07-26: 25 Source Signer tests, 24
  buyer-runtime tests, 9 adapter tests, 36 hosted-web commitment tests, and 6
  Solidity V2 tests passed. Relevant TypeScript workspaces and the production
  extension bundle also passed.
- Final repository CI on 2026-07-26 passed Prisma validation and generation,
  lint, every TypeScript workspace, 44 Vitest files with 347 tests, all 23
  Solidity tests, and the production Next.js build.
- Onchain V2 evidence includes temporary-payer funding, delegate deployment,
  two delegated rescue actions, zero-address clearing, gas refund, empty final
  source code, zero selected source-token balances, and destination balance
  increases. Transaction hashes are recorded in
  `EIP7702_CANARY_EVIDENCE.md`.

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
4. X Layer V2 EIP-7702 is internally verified and enabled for committed native,
   ERC-20, ERC-721, ERC-1155, ERC-20 approval-revocation, and NFT
   operator-revocation actions. EIP-7702 on other chains, protocol claims,
   withdrawals, Permit2, and private bundles remain blocked.
5. A malicious or severely non-standard asset contract can violate expected
   token semantics. SAFEEXIT is best effort, not universal recovery.
6. The EIP-7702 path uses the public X Layer mempool. An attacker holding the
   same source key can race, replace, or invalidate the source authorization.
7. WDK is beta, the source key exists briefly inside the local extension popup,
   and JavaScript cannot guarantee immediate erasure of engine-managed strings.
8. `npm audit --omit=dev` reports zero production vulnerabilities. The full
   development dependency tree still inherits `brace-expansion` advisories
   through ESLint/minimatch; the available automatic remediation requires an
   ESLint major upgrade and is tracked as tooling-only release maintenance.

## Release recommendation

Do not label this release independently audited. Enable every deterministically
verified and freshly simulated supported route without an arbitrary monetary
cap, retain fail-closed behavior for unsupported routes, and perform an
operator-owned mainnet canary when introducing a new adapter or token behavior.
Use `AUDIT_SCOPE.md` when an external review becomes practical and publish any
future report with its exact remediation commit.
