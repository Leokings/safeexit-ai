# Security Policy

SAFEEXIT is a best-effort defensive wallet incident-response system. Never send
it seed phrases, private keys, wallet keystores, raw credentials, or source
wallet signatures.

## Dependency advisory record

As of 2026-07-13, `npm audit` reports GHSA-qx2v-qp2m-jg93 through Next.js's
exact nested dependency on PostCSS 8.4.31. The current stable Next.js release is
16.2.10 and still pins that version; npm's automated fix incorrectly proposes a
breaking downgrade to Next.js 9.3.3.

The advisory concerns stringifying attacker-controlled CSS containing a closing
style tag. SAFEEXIT does not accept, generate, or stringify user-provided CSS;
PostCSS is used during the trusted application build and is not an API input.
The deployment also applies a restrictive content security policy.

Do not run `npm audit fix --force` for this finding. Upgrade Next.js as soon as a
stable release depends on PostCSS 8.5.10 or newer, then remove this temporary
risk acceptance after CI and browser verification.

## Mainnet ERC-3009 review boundary

The provider never receives source-wallet signatures and never submits rescue
transactions. For ERC-3009, SAFEEXIT verifies the token's EIP-712 domain,
`RECEIVE_WITH_AUTHORIZATION_TYPEHASH`, chain, contract, current source balance,
and unused random nonce before issuing a short-lived signing package. The
package commits the exact source, destination, token, amount, validity window,
simulation, and plan hash. The buyer-local runtime recovers the signer, checks
the active five-minute-or-shorter window, re-simulates the exact settlement
after signing, and permits only the confirmed destination wallet to submit it.

This is an internal engineering review, not an independent smart-contract or
protocol audit. See `INTERNAL_SECURITY_REVIEW.md`, `THREAT_MODEL.md`, and
`AUDIT_SCOPE.md`. The mainnet route is enabled for narrowly scoped permit-only
recovery, but high-value use still requires a controlled canary with
operator-owned funds followed by independent security review.

## Distributed abuse controls

Production rate limits are atomic PostgreSQL records keyed by a one-way hash;
raw client addresses are not stored. Public, authenticated-agent, preflight,
and paid x402 requests have separate scopes. Limits fail closed when the shared
store is unavailable, and paid-route throttling occurs before payment handling.

Report suspected vulnerabilities privately to the repository owner. Do not
test rescue execution against wallets or assets you do not control.
