# SAFEEXIT Security Review Scope

## Review target

- Product: SAFEEXIT AI
- Networks: Ethereum `1`, BNB Smart Chain `56`, Polygon `137`, Arbitrum
  `42161`, Optimism `10`, Base `8453`, Avalanche C-Chain `43114`, and X Layer
  `196`
- Original internal-review baseline: commit
  `cea127495a692dab372186a3b6239e00bfa9787f`
- Multichain release: the commit containing
  `MULTICHAIN_ADAPTER_VERIFICATION.md`
- Production URL: `https://safeexit.xyz`

SAFEEXIT uses the internally reviewed `SafeExitPermitSettlementV2` Solidity
contract at `contracts/src/SafeExitPermitSettlementV2.sol`. Its deterministic
X Layer address is `0x73E8A8d165EC9710aC27f91B0Df02975CC4a48d0`;
production remains fail-closed until it is deployed and verified. The review
must cover the contract, browser
and buyer-runtime EIP-712 construction, capability detection, simulation,
submission, and receipt verification as one system.

## In scope

- EIP-712 domain and message construction for ERC-3009, ERC-2612, DAI-style
  permit, and ERC-4494.
- Source, destination, chain, contract, amount, token ID, nonce, deadline, and
  plan-hash commitments.
- Browser account handoff, local signature handling, settlement-contract
  calls, receipt verification, and failure handling.
- Buyer-local signing, exact-call simulation interface, submission, and
  receipt-only reporting.
- X Layer EIP-7702 package construction, Source Signer extension, pinned
  factory verification, temporary-payer funding, type-4 submission, canonical
  clearing, and gas refund.
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
- `contracts/src/SafeExitPermitSettlementV2.sol`
- `contracts/test/SafeExitPermitSettlementV2.ts`
- `packages/adapters/src/permit-settlement.ts`
- `packages/agent-service/src/signing-package.ts`
- `packages/buyer-runtime/src/`
- `apps/signer-extension/src/`
- `apps/signer-extension/public/manifest.json`
- `packages/agent-service/src/eip7702-signing-package.ts`
- `packages/adapters/src/eip7702-rescue.ts`
- `contracts/src/SafeExit7702RescueDelegate.sol`
- `contracts/src/SafeExit7702RescueDelegateFactory.sol`
- `packages/planner/src/`
- `packages/scanner/src/`
- `packages/simulator/src/`
- `packages/security/src/`
- `packages/persistence/src/`

### EIP-7702 route review

The currently enabled X Layer V2 route requires review across:

- `contracts/src/SafeExit7702RescueDelegate.sol`
- `contracts/src/SafeExit7702RescueDelegateFactory.sol`
- `contracts/test/SafeExit7702RescueDelegate.ts`
- `packages/adapters/src/eip7702-rescue.ts`
- `packages/adapters/tests/eip7702-rescue.test.ts`
- `packages/agent-service/src/eip7702-signing-package.ts`
- `packages/buyer-runtime/src/eip7702-runtime.ts`
- `packages/buyer-runtime/src/eip7702-viem.ts`
- `packages/buyer-runtime/src/eip7702-funded-payer.ts`
- `packages/buyer-runtime/src/eip7702-extension-bridge.ts`
- `packages/buyer-runtime/tests/eip7702-runtime.test.ts`
- `apps/web/src/lib/live-eip7702-signing-package-builder.ts`
- `apps/signer-extension/src/`

That review must include CREATE2 configuration commitments, immutable runtime
verification, delegated execution context, storage-slot isolation, fixed
recipient enforcement, per-action replay handling, token postconditions,
type-4 transaction sponsorship, local-account isolation, source-nonce races,
cleanup after partial failure, public-mempool exposure, and confirmed
delegation clearing.

## Required security properties

1. SAFEEXIT APIs, pages, logs, prompts, and persistence never request, receive,
   store, or transmit a source private key, seed phrase, or keystore. The
   separately installed Source Signer may accept one raw source key only inside
   its local popup, must never transmit or store it, and must dispose and zero
   its owned mutable buffer after the two bounded authorizations.
2. Every authorization binds the exact source, destination, chain, asset,
   amount or token ID, nonce, and short expiry.
3. AI output cannot create or modify executable calls.
4. A refreshed preflight cannot silently substitute a different reviewed route.
5. Permit settlement requires the committed destination account. EIP-7702 may
   use any fresh capped payer, but every transfer is forced to the immutable
   destination and the source pays no gas.
6. Permit, transfer, and allowance revocation execute atomically inside one
   fixed settlement-contract transaction. EIP-7702 actions are isolated
   transactions with immutable plan commitments and per-action replay state.
7. Failed simulation is fail-closed, and confirmed execution requires evidence
   of the exact committed transfer.
8. Native currency and assets without a verified destination-paid adapter
   remain non-executable, except for actions included in a freshly verified X
   Layer V2 EIP-7702 package.

## Out of scope and external trust

- The internal security of OKX Wallet, Agentic Wallet, Vercel, PostgreSQL
  providers, RPC providers, supported-chain consensus, and third-party token contracts.
- Compromise of the user's browser, operating system, wallet extension, or
  destination wallet.
- Distinguishing the legitimate owner from an attacker when both possess the
  same source private key.
- Private bundles, Permit2, ERC-1155 permit settlement, protocol claims, and
  protocol withdrawals. X Layer V2 EIP-7702 is in scope because it is enabled;
  EIP-7702 on other chains remains outside the production surface.
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
