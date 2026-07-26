# SAFEEXIT Cloud Handoff

## Checkpoint scope

This checkpoint contains the current production SAFEEXIT codebase, including:

- OKX A2MCP/x402 paid rescue preparation.
- Deterministic scanning, planning, and signing-package generation.
- Shared settlement and direct authorization recovery routes.
- Buyer runtime support for local wallet authorization.
- EIP-7702 delegate, factory, adapters, signing-package types, and canary tooling.
- Security, deployment, threat-model, and canary evidence updates.

## Safety state

- SAFEEXIT remains non-custodial.
- Private keys, seed phrases, keystores, and raw wallet credentials must never
  enter server APIs, logs, prompts, or persistence.
- The destination address must remain explicitly committed in every signing
  package.
- X Layer V2 EIP-7702 is internally verified and active for strict package-bound
  actions. It is public-mempool, best effort, and not independently audited.
- The Source Signer must verify the pinned factory and predicted delegate
  through both configured official X Layer RPCs. Never activate a route merely
  because a wallet displays an upgrade prompt.

## Latest local verification

- A V2 X Layer mainnet rescue and canonical clearing completed; public evidence
  is recorded in `EIP7702_CANARY_EVIDENCE.md`.
- The 2026-07-26 internal follow-up fixed factory-prediction verification,
  complete-plan selection, funding caps, canonical clearing postconditions,
  production origin scope, and result reporting.
- Final repository CI passed on 2026-07-26: Prisma validation and generation,
  lint, every TypeScript workspace, 44 Vitest files with 347 tests, all 23
  Solidity tests, and the production Next.js build.
- The production dependency scan (`npm audit --omit=dev`) reports zero
  vulnerabilities.

## Working constraints

- Work sequentially.
- Do not run multiple builds, test commands, development servers, or package
  installations simultaneously.
- Avoid the full test suite unless a broad change makes it necessary.
- Stop every temporary process when finished.
