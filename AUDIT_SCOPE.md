# SAFEEXIT Security Review Scope

## Review target

- Product: SAFEEXIT AI
- Network: X Layer mainnet, chain ID `196`
- Review baseline: commit `cea127495a692dab372186a3b6239e00bfa9787f`
- Remediation release: the commit containing `INTERNAL_SECURITY_REVIEW.md`
- Production URL: `https://safeexit.xyz`

SAFEEXIT does not currently deploy a production settlement contract. The
security-critical implementation is a TypeScript EVM application that creates
strict EIP-712 authorizations, keeps signatures in the user's browser or local
buyer runtime, and asks a user-controlled destination wallet to submit calls.
The appropriate engagement is therefore an application, protocol-integration,
and EVM authorization review, not a Solidity-only audit.

## In scope

- EIP-712 domain and message construction for ERC-3009, ERC-2612, DAI-style
  permit, and ERC-4494.
- Source, destination, chain, contract, amount, token ID, nonce, deadline, and
  plan-hash commitments.
- Browser account handoff, local signature handling, EIP-5792 atomic batches,
  receipt verification, and failure handling.
- Buyer-local signing, full-batch simulation interface, submission, and
  receipt-only reporting.
- Deterministic scanning, rescue planning, simulation gating, and signing
  package schemas.
- Mainnet preflight and agent APIs, authentication, x402 payment isolation,
  validation, rate limiting, persistence, CSP, and log redaction.
- Dependency and deployment configuration relevant to the production path.

Primary implementation locations:

- `apps/web/src/lib/okx-wallet.ts`
- `apps/web/src/components/mainnet-rescue-workspace.tsx`
- `apps/web/src/app/api/rescue/[id]/preflight/route.ts`
- `apps/web/src/lib/live-signing-package-builder.ts`
- `apps/web/src/lib/live-buyer-report-verifier.ts`
- `packages/agent-service/src/signing-package.ts`
- `packages/buyer-runtime/src/`
- `packages/planner/src/`
- `packages/scanner/src/`
- `packages/simulator/src/`
- `packages/security/src/`
- `packages/persistence/src/`

## Required security properties

1. SAFEEXIT never requests, receives, stores, logs, or transmits a source
   private key, seed phrase, keystore, or source signature.
2. Every authorization binds the exact source, destination, chain, asset,
   amount or token ID, nonce, and short expiry.
3. AI output cannot create or modify executable calls.
4. A refreshed preflight cannot silently substitute a different reviewed route.
5. Only the committed destination may submit, and it pays settlement gas.
6. Multi-call permit routes execute only with an EIP-5792 atomicity guarantee.
7. Failed simulation is fail-closed, and confirmed execution requires evidence
   of the exact committed transfer.
8. Native OKB and assets without a verified destination-paid adapter remain
   non-executable.

## Out of scope and external trust

- The internal security of OKX Wallet, Agentic Wallet, Vercel, PostgreSQL
  providers, RPC providers, X Layer consensus, and third-party token contracts.
- Compromise of the user's browser, operating system, wallet extension, or
  destination wallet.
- Distinguishing the legitimate owner from an attacker when both possess the
  same source private key.
- Native OKB rescue, EIP-7702 delegates, private bundles, Permit2, ERC-1155
  settlement, protocol claims, and protocol withdrawals.
- Economic guarantees, asset valuation, and universal token compatibility.

## Reproduction

Use Node.js 24 and npm 11 with the committed lockfile:

```text
npm ci
npm audit --omit=dev
npm audit signatures
npm run ci
```

No live-wallet credential is required for the test suite. Never place a private
key or source signature in an audit ticket, repository, fixture, or log.

## Requested external deliverables

The independent reviewer should provide:

- architecture and threat-model review;
- manual review of every in-scope authorization and settlement path;
- adversarial tests for replay, destination substitution, chain confusion,
  stale state, account switching, malformed token behavior, and false-success
  receipts;
- dependency and web-boundary review, including XSS/signature exfiltration;
- a severity-ranked report tied to an exact commit;
- remediation verification tied to a second exact commit.

