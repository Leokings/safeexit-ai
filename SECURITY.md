# Security Policy

SAFEEXIT is a best-effort defensive wallet incident-response system. Never send
it seed phrases, private keys, wallet keystores, raw credentials, or source
wallet signatures.

## Dependency advisory record

As of 2026-07-15, the committed dependency graph reports zero known
vulnerabilities through `npm audit`. Dependency scanning remains part of release
verification; a clean scan is evidence about the current advisory database, not
a guarantee that dependencies contain no vulnerabilities.

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
`AUDIT_SCOPE.md`. Supported mainnet routes do not impose a monetary-value cap.
Execution remains limited by deterministic capability verification, exact
destination-bound authorization, fresh simulation, and receipt evidence. A
controlled operator-owned canary is recommended when enabling a new route or
asset implementation, but an external audit is not a runtime prerequisite.

Receipt evidence is accepted as complete only after the configured per-chain
confirmation threshold and canonical-block checks before and after final asset
state verification. These application thresholds reduce reorg risk but are not
represented as irreversible protocol finality.

## Distributed abuse controls

Production rate limits are atomic PostgreSQL records keyed by a one-way hash;
raw client addresses are not stored. Public, authenticated-agent, preflight,
and paid x402 requests have separate scopes. Limits fail closed when the shared
store is unavailable, and paid-route throttling occurs before payment handling.

Report suspected vulnerabilities privately to the repository owner. Do not
test rescue execution against wallets or assets you do not control.
