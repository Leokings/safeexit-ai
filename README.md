# SAFEEXIT AI

The current foundation contains the TypeScript monorepo, shared domain schemas,
verified chain configuration, deterministic standard-token scanners, and an
opt-in official OKX Wallet API balance-discovery adapter. Mainnet signing and
submission remain disabled.

## Deterministic scanning

The scanner pins one block and obtains values only from EVM read calls or
explicit test fixtures. ERC-20 contracts, ERC-721/ERC-1155 token IDs, spenders,
and NFT operators must be supplied in a scan manifest. An empty result means
only that no state was found for the requested manifest; it is not a claim that
the wallet has no other assets or approvals.

Scanner states have distinct meanings:

- `DETECTED`: a positive balance, ownership record, or active approval was read.
- `SUPPORTED`: the requested deterministic standard read completed, including a
  valid zero/false result.
- `UNSUPPORTED`: no verified implementation is enabled, currently including
  Permit2 approval scanning.
- `UNKNOWN`: a configured read failed or could not determine state. It is never
  converted into a zero balance.

Configured chains are X Layer mainnet (primary), X Layer testnet, and local
Anvil. X Layer values are sourced from the
[official network documentation](https://web3.okx.com/onchainos/dev-docs/xlayer/developer/build-on-xlayer/network-information).

## Deterministic planning

The rescue planner converts a validated `WalletScan` into a dependency-ordered
`RescuePlan`. Standard assets produce typed transfers, related approval
revocations depend on those transfers, verified adapter outputs depend on their
claim/withdrawal action, and native balance rescue is ordered last. Native
amounts use `MAX_MINUS_GAS_RESERVE`; a later simulation phase must resolve the
actual amount before execution.

Adapter candidates are accepted only when they match a code-owned trust record
for adapter ID, version, chain, contract, action kind, custom operation, and
output contracts. The planner accepts no generic target/calldata action and its
strict input rejects externally supplied executable lists.

Plans are deeply frozen and carry a deterministic integrity hash. The hash can
detect changes between planning and simulation, but it is not a wallet
signature or user authorization.

## Local simulation

The local/test simulation provider encodes supported standard actions, runs a
block-pinned call, and estimates gas without submitting a transaction. It
captures success, provider failures, revert messages, gas estimates, and basic
typed transfer effects. Transfer effects are inferred after a successful call
and are explicitly not represented as a full trace-based state diff.

Native rescue simulation reserves gas for the native transfer and earlier
successfully simulated actions. Failed, reverted, unsupported, and
dependency-blocked actions are excluded from `executableActions` by the plan
simulation orchestrator.

Production simulators are represented only by an
`OfficialDocsRequiredSimulationProvider`; it has no endpoint or invented API.
Adapter actions require a separately reviewed local simulation resolver.

## Commands

```bash
npm install
npm run typecheck
npm test
npm run build
```

The workspace uses npm workspaces under `apps/*` and `packages/*`.

## Hosted service preparation

Production mode serves the verified demo as a clearly labelled read-only
replay. The local fixed executor is never exposed in hosted mode. A
bearer-authenticated, provider-neutral agent lifecycle is available under
`/api/agent/jobs`; it supports create, analyze, plan, simulate, monitor, and
status operations but cannot sign or broadcast transactions.

An opt-in `LIVE_READONLY` agent mode replaces fixture analysis with real X Layer
mainnet reads. It discovers non-risk ERC-20 candidates through the official OKX
Wallet API, rechecks each candidate at a pinned block through a dedicated RPC,
then uses the deterministic planner and real RPC preflight provider. The scan is
always `PARTIAL` while NFT and approval discovery remain incomplete. Required
server-only credentials and readiness gates are documented in
[`DEPLOYMENT.md`](DEPLOYMENT.md).

Deployment variables, database migration steps, API smoke tests, and the
official-docs-required OKX handoff are documented in
[`DEPLOYMENT.md`](DEPLOYMENT.md).

## Destination-paid X Layer testnet pilot

The X Layer testnet rescue workspace supports multiple destination-paid asset
routes. ERC-3009 is preferred for fungible tokens when its capability and EIP-712 domain are
verified onchain. The reported source signs a short-lived
`ReceiveWithAuthorization` message and the destination submits it.

ERC-2612 is a fallback for permit-compatible tokens. The source signs a permit
whose spender is the safe destination. SAFEEXIT verifies that exact permit
with an RPC call, requires OKX Wallet to report atomic batch support, then asks
the destination to atomically submit `permit` and `transferFrom` through the
official EIP-5792 wallet methods. In both routes the source submits no
transaction and pays no network fee.

ERC-721 NFTs can use an ERC-4494 fallback when the explicit collection/token ID
is owned by the source and the collection reports the ERC-4494 interface plus a
verifiable EIP-712 domain and nonce. The source signs the NFT permit; the
destination atomically submits `permit` and `transferFrom` and pays gas.

Authorization signatures remain in browser memory and are never sent to or
stored by SAFEEXIT. Assets without a verified permit route, native OKB,
ERC-1155 assets, approvals, airdrops, and positions stay blocked until a
verified destination-paid adapter exists. A successful testnet pilot is not
approval to enable mainnet execution.

Native OKB recovery remains non-executable. The adapter package records
fail-closed requirements for an audited EIP-7702 sponsor or an official X Layer
private atomic relay, including bytecode allowlisting, signed target/value/gas
bounds, pinned simulation, no public-mempool fallback, and revocation handling.

One injected wallet exposes one active account at a time. The browser flow is
therefore sequential: activate the source and sign, keep the tab open, switch
OKX Wallet to the safe destination, then submit settlement. Both accounts do
not need to remain connected simultaneously.

## Hackathon demo

The three-minute walkthrough uses only developer-created contracts and public
Anvil accounts. It demonstrates detection, planning, snapshot simulation,
decoded review, fixed local signing, execution progress, and final-state
verification.

### Prepare once

Prerequisites are Node.js 24, `npm install`, and Foundry. The scripts also
detect workspace-local Foundry binaries in `.tools/foundry`.

```powershell
npm run demo:prepare
npm run dev
```

`demo:prepare` starts a managed hidden Anvil process on `127.0.0.1:8545`, runs
the Solidity tests, deploys the fixed contracts, seeds the incident, executes
the complete rescue on an Anvil snapshot, records real gas receipts, verifies
the final effects, and reverts to the original at-risk state. Open
`http://localhost:3000/demo`, or use the alternate port printed by Next.js.

### Three-minute story

1. **0:00 - Incident scan:** show `CRITICAL INCIDENT`, 100 SRT, Demo NFT #1,
   the 50 SRT claimable reward, and the 25 SRT fixed attacker allowance.
2. **0:30 - AI analysis:** show that every statement cites structured evidence
   and that AI cannot edit the action list.
3. **0:55 - Rescue plan:** review claim, ERC-20 transfer, NFT transfer, then
   approval revocation with dependencies.
4. **1:20 - Simulation:** show the four real snapshot receipts, measured gas,
   final-state checks, blocked sweep, and successful snapshot restore.
5. **1:50 - Review and sign:** confirm source, destination, target contracts,
   and the authorization statement. Select **Execute fixed Anvil rescue**.
6. **2:15 - Execution:** watch the four confirmed transactions, then present
   the final incident report showing 150 SRT and NFT #1 at the destination,
   zero claimable reward, zero allowance, and zero SRT at the source.

The execution API is disabled in production and for non-local hosts. It can
spawn only `scripts/demo/run-rescue.ps1`, which refuses chains other than
`31337` and uses fixed public Anvil accounts, contract addresses, recipient,
and action signatures. It accepts no RPC URL, wallet, key, calldata, or target
from the browser.

### Demo commands

```powershell
npm run demo:prepare  # restart, reseed, and resimulate the managed fixture
npm run demo:seed     # seed a separately started fresh Anvil chain
npm run demo:rescue   # terminal fallback for the same fixed rescue
npm run demo:stop     # stop only the managed SAFEEXIT Anvil process
npm run contracts:test
```

`demo:attacker` is an optional failure-path demonstration that can target only
the fixed developer wallet and sink. It invalidates the seeded walkthrough, so
run `npm run demo:prepare` afterward.

The mnemonic and private keys in `scripts/demo/common.ps1` are Anvil's public
development fixtures. Never fund or reuse them.

### Limitations

- Recovery is best effort. An EVM chain cannot distinguish the legitimate owner
  from another party holding the same private key.
- The fixed multi-asset demo executor is localhost-only. The separate X Layer
  testnet pilot supports only verified ERC-3009 token authorizations.
- Permit2 discovery, arbitrary protocol positions, production simulation,
  private submission, paymasters, and OKX-specific execution are not connected.
- Snapshot success does not guarantee production execution. Gas, ordering,
  chain state, protocol behavior, and attacker behavior can change.
- `/` and non-demo `/rescue/[id]` remain review drafts and never claim to scan,
  sign, or broadcast a production transaction.

## Phase 7 grounded explanation layer

`@safeexit/ai` accepts only validated `Incident`, `WalletScan`, `RescuePlan`,
`SimulationResult`, and rescue-status snapshots. It exposes exactly six internal
tools: `scan_wallet`, `scan_approvals`, `get_rescue_plan`, `simulate_plan`,
`explain_action`, and `get_rescue_status`.

Model providers may return only an intent and IDs already present in the
incident snapshot. They cannot author facts, transaction targets, calldata,
recipients, chain IDs, or execution requests. Display text is produced by the
grounded renderer and cites the source records used.

No external model provider is configured. The demo chat therefore identifies
itself as a deterministic fallback and remains fully usable without credentials.

## Phase 8 agent-service preparation

`@safeexit/agent-service` adds the provider-neutral incident job lifecycle and
the methods `createIncident`, `analyseIncident`, `generatePlan`, `simulatePlan`,
`getDashboardUrl`, and `monitorRescue`. Scanner, planner, simulator, dashboard,
and monitor behavior are injected ports. There is no execution or wallet port.

The package also contains versioned conceptual A2A request/response schemas.
They are SAFEEXIT contracts, not claimed OKX wire formats. ASP registration,
escrow, Agentic Wallet, marketplace, and service discovery are all explicitly
`OFFICIAL_DOCS_REQUIRED` and unimplemented. See
[`packages/agent-service/README.md`](packages/agent-service/README.md) for the
transition graph and official references.

## Phase 9 persistence and hardening

`@safeexit/persistence` uses Prisma with PostgreSQL for incidents, scans,
assets, approvals, plans, actions, simulations, execution attempts, and agent
jobs. Agent lifecycle transitions are normalized as separate records. The
schema intentionally has no private-key, seed-phrase, wallet-credential,
signature, calldata, or raw-transaction columns.

Copy the server-only values from `.env.example` into a local `.env`, then run:

```powershell
npm run db:validate
npm run db:generate
npx prisma migrate deploy
```

`POST /api/incidents` is the first persisted API boundary. It requires the
ownership confirmation, accepts only strict JSON, enforces a body limit and a
per-process rate limit, and returns `503 PERSISTENCE_NOT_CONFIGURED` when no
database is configured. It never falls back to fake persistence. Production
deployments with multiple instances should replace the in-memory limiter with
a trusted shared rate-limit adapter at the deployment edge.

The web app applies CSP, clickjacking protection, MIME-sniffing protection,
referrer policy, permissions policy, and production HSTS. Security logging
redacts wallet secrets, credentials, signatures, transaction payloads, and
credential-bearing PostgreSQL URLs.
