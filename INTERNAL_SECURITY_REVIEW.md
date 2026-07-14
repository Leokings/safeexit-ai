# SAFEEXIT Internal Security Review

## Status

- Review date: 2026-07-14
- Baseline: `cea127495a692dab372186a3b6239e00bfa9787f`
- Reviewer: OpenAI Codex, also involved in implementation
- Classification: internal engineering review, not an independent audit or a
  guarantee of fund safety

The review covered the X Layer mainnet destination-paid recovery path, hosted
agent APIs, local buyer runtime, x402 boundary, persistence, deployment
configuration, and browser security boundary. SAFEEXIT has no custom production
settlement contract in this release.

This review predates the eight-network adapter expansion. The multichain release
preserves the reviewed authorization and settlement invariants and is recorded
separately in `MULTICHAIN_ADAPTER_VERIFICATION.md`; that internal verification
does not widen this review into an independent audit.

## Resolved findings

| ID | Severity | Finding | Resolution |
| --- | --- | --- | --- |
| SE-01 | High | Browser receipt success was treated as transfer success without proving the committed asset moved. A token returning `false` could create a false-positive completion. | Browser now requires an exact `Transfer` event from the committed source to destination for the exact amount or token ID. |
| SE-02 | High | A fresh preflight could silently fall back to the first route if the route reviewed by the user disappeared. | Signing now fails closed until the user reviews and explicitly selects a route from the fresh result. |
| SE-03 | Medium | The UI read the active account before switching to X Layer and reused it; the buyer runtime did not recheck account/chain after simulation. | Account and chain are re-read after switching and immediately before submission. |
| SE-04 | Medium | EIP-5792 submission parsing accepted only a legacy string, while the standard response is `{ "id": "..." }`. | Browser and buyer runtime accept the standard object and the legacy string defensively. |
| SE-05 | Medium | Secure logging redacted structured secrets but could preserve a credential-bearing RPC URL inside an error message. | Error strings now redact HTTP(S) URLs, bearer values, and OKX access headers. |
| SE-06 | Low | Obsolete local demo contracts, attacker scripts, and public Anvil keys remained in the repository even though they were not deployed. | The contract/demo directories, scripts, commands, and unused OpenZeppelin dependency were removed. |
| SE-07 | Low | Security-critical x402 dependencies used semver ranges. | Installed OKX x402 versions are now exactly pinned in `package.json` and the lockfile. |
| SE-08 | Low | Environment schemas allowed malformed RPC/credential strings to reach runtime checks. | RPCs must be exact HTTPS URLs; server credentials reject line breaks. |

## Verification performed

- Manual review against ERC-2612, ERC-3009, ERC-4494, EIP-5792, and EIP-712
  authorization requirements.
- Targeted adversarial unit tests for route substitution, account switching,
  standard EIP-5792 responses, false transfer evidence, simulation failure,
  and log leakage.
- Full lint, TypeScript, Vitest, Prisma, and Next.js production build through
  `npm run ci`.
- `npm audit --omit=dev`, registry signature verification, secret-pattern scan,
  and dependency inventory.
- Read-only X Layer RPC capability probe. No live source signature or asset
  transfer was produced during this review.

## Accepted and open risk

1. This review is not independent because the reviewer also helped implement
   the system. Obtain an external review before representing SAFEEXIT as
   audited or encouraging high-value use.
2. The public X Layer RPC rejects `eth_simulateV1`. Browser settlement therefore
   cannot independently replay the complete stateful permit batch before
   submission. EIP-5792 atomicity, exact permit-call preflight, and receipt
   evidence mitigate this, but do not eliminate provider and token risk.
3. `npm audit` reports the documented moderate PostCSS advisory through Next.js
   16.2.10. SAFEEXIT does not process untrusted CSS; upgrade when stable Next.js
   removes the vulnerable nested dependency.
4. The production CSP includes `'unsafe-inline'` for Next.js compatibility.
   There is no unsafe HTML rendering in the reviewed tree, but browser-side
   signature memory makes future XSS regressions high impact.
5. Native OKB, ERC-1155 settlement, protocol claims, withdrawals, EIP-7702, and
   private bundles remain blocked and were not approved by this review.
6. A malicious or severely non-standard asset contract can violate expected
   token semantics. SAFEEXIT is best effort, not universal recovery.

## Release recommendation

Do not label this release independently audited. Keep use limited to supported
permit routes, perform a low-value operator-owned mainnet canary for each route,
retain the current blocked-asset behavior, and commission an external review
using `AUDIT_SCOPE.md`. Publish the external report and remediation commit before
removing the unaudited warning or encouraging high-value rescues.
