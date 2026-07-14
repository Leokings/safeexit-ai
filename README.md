# SAFEEXIT AI

The current foundation contains the TypeScript monorepo, shared domain schemas,
verified chain configuration, deterministic standard-token scanners, and an
opt-in official OKX Wallet API balance-discovery adapter, and a buyer-local
signing and settlement runtime. X Layer mainnet execution is enabled only for
strictly verified destination-paid permit routes; native and unsupported assets
remain blocked.

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

Production recovery supports X Layer mainnet only. A local Anvil adapter remains
available to deterministic unit tests, but the production repository no longer
contains a demo UI, attacker fixture, or demo deployment scripts. X Layer values are sourced from the
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

Security review boundaries, threats, and current findings are documented in
`AUDIT_SCOPE.md`, `THREAT_MODEL.md`, and `INTERNAL_SECURITY_REVIEW.md`.

## Hosted service preparation

Production has no fixture or replay mode. A bearer-authenticated,
provider-neutral agent lifecycle is available under
`/api/agent/jobs`; it supports create, analyze, plan, simulate, strict signing
package delivery, buyer receipt reporting, monitor, and status operations. The
hosted service cannot sign or broadcast transactions: source authorization and
destination-paid settlement stay in the buyer's local runtime. Jobs are
dashboardless by default; an audit URL is created only through the explicit
dashboard endpoint.

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

## Normalized OKX A2A provider bridge

`@safeexit/okx-transport` adds an authenticated provider bridge for work that
the official OKX runtime has already moved to `job_accepted`. It pins each OKX
job to one idempotent SAFEEXIT request, validates the exact ownership statement,
and returns a strict signing-package deliverable. A separate endpoint accepts
only the buyer's receipt report and completes the job after independent onchain
proof.

The bridge does not implement or imitate OKX marketplace discovery, XMTP,
payment, task acceptance, or delivery. Those remain in the official runtime.
It also does not expose an Agentic Wallet credential or let an Agentic Wallet
sign for the compromised source EOA. See
[`packages/okx-transport/README.md`](packages/okx-transport/README.md).

## Direct paid OKX API service

The production fast path is `POST /api/agent/okx/prepare-paid`. It uses the
official OKX x402 Next.js middleware at a fixed `$0.10` price on X Layer
mainnet. After payment verification, the endpoint runs scanner, planner, and
simulation code directly and returns a strict signing package in the same HTTP
request. It also returns an explanation-only incident analysis. In hosted AI
mode, DeepSeek may select an intent and existing evidence IDs; deterministic
code still writes the response and remains the sole source of executable plan
data. No negotiation loop, polling worker, or encrypted report file is
involved.

Buyer agents should call this A2MCP endpoint directly. They should not publish
an A2A task and wait for marketplace events for deterministic preparation.
The payment wallet and `SAFEEXIT_X402_PAY_TO_ADDRESS` must be different
addresses; self-payments are rejected before facilitator verification.

The existing agent-to-agent service remains useful for non-standard incident
support. Deterministic preparation should be listed separately as an API
service so ordinary rescues do not inherit conversational task latency.
Payment does not grant execution authority: source signing stays local and the
destination still performs post-signature simulation and pays settlement gas.
Model failure, timeout, invalid output, or token-budget overflow falls back to
the deterministic explanation without changing the signing package. AI usage
is persisted per SAFEEXIT job for cost accounting.

## Destination-paid X Layer mainnet recovery

The X Layer mainnet rescue workspace supports multiple destination-paid asset
routes. ERC-3009 is preferred for fungible tokens when its capability and EIP-712 domain are
verified onchain. The reported source signs a short-lived
`ReceiveWithAuthorization` message and the destination submits it with real
mainnet gas.

ERC-2612 is a fallback for permit-compatible tokens. The source signs a permit
whose spender is the safe destination. SAFEEXIT verifies that exact permit
with an RPC call, requires OKX Wallet to report atomic batch support, then asks
the destination to atomically submit `permit` and `transferFrom` through the
official EIP-5792 wallet methods. In both routes the source submits no
transaction and pays no network fee.

DAI-style permits are supported when the token exposes the exact legacy permit
type hash and its `name`, version `1`, chain ID, contract address, and domain
separator agree. The source signs consecutive allow and revoke permits. The
destination atomically submits `permit(true)`, `transferFrom`, and
`permit(false)`, leaving no DAI-style allowance after settlement.

ERC-721 NFTs can use an ERC-4494 fallback when the explicit collection/token ID
is owned by the source and the collection reports the ERC-4494 interface plus a
verifiable EIP-712 domain and nonce. The source signs the NFT permit; the
destination atomically submits `permit` and `transferFrom` and pays gas.

Authorization signatures remain in browser memory and are never sent to or
stored by SAFEEXIT. Assets without a verified permit route, native OKB,
ERC-1155 assets, approvals, airdrops, and positions stay blocked until a
verified destination-paid adapter exists. The mainnet route is best effort and
has not received an independent security audit.

Native OKB recovery remains non-executable. The adapter package records
fail-closed requirements for an audited EIP-7702 sponsor or an official X Layer
private atomic relay, including bytecode allowlisting, signed target/value/gas
bounds, pinned simulation, no public-mempool fallback, and revocation handling.

One injected wallet exposes one active account at a time. The browser flow is
therefore sequential: activate the source and sign, keep the tab open, switch
OKX Wallet to the safe destination, then submit settlement. Both accounts do
not need to remain connected simultaneously.

## Phase 7 grounded explanation layer

`@safeexit/ai` accepts only validated `Incident`, `WalletScan`, `RescuePlan`,
`SimulationResult`, and rescue-status snapshots. It exposes exactly six internal
tools: `scan_wallet`, `scan_approvals`, `get_rescue_plan`, `simulate_plan`,
`explain_action`, and `get_rescue_status`.

Model providers may return only an intent and IDs already present in the
incident snapshot. They cannot author facts, transaction targets, calldata,
recipients, chain IDs, or execution requests. Display text is produced by the
grounded renderer and cites the source records used.

Production uses a bounded Vercel AI Gateway model when configured. Model
failure falls back to the deterministic grounded renderer and never changes
the executable plan.

## Phase 8 agent-service preparation

`@safeexit/agent-service` adds the provider-neutral incident job lifecycle and
the methods `createIncident`, `analyseIncident`, `generatePlan`, `simulatePlan`,
`getSigningPackage`, `recordBuyerExecutionReport`, `getDashboardUrl`, and
`monitorRescue`. Scanner, planner, simulator, signing-package, receipt
verification, dashboard, and monitor behavior are injected ports. The hosted
service has no signing or wallet-execution port.

Signing packages are short-lived strict schemas, not generic unsigned
transactions. They commit to the confirmed source and destination, plan hash,
pinned block, simulation, route, asset, and exact operation sequence. The buyer
runtime requests EIP-712 signatures locally, verifies the recovered signer,
post-simulates the assembled call sequence, and pays settlement gas from the
destination. It supports ERC-3009, ERC-2612, DAI-style permit, and ERC-4494
routes. SAFEEXIT accepts neither signatures nor arbitrary calldata. It accepts
only a receipt-only completion report, then independently proves the exact
committed transfer from chain receipts before completing the job.

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
shared PostgreSQL rate limit in production, and returns `503` when persistence
or request protection is unavailable. It never falls back to fake persistence.
The agent, paid x402, incident, and preflight boundaries use the same fail-closed
shared store with separate scopes; development and tests retain an in-memory
implementation.

The web app applies CSP, clickjacking protection, MIME-sniffing protection,
referrer policy, permissions policy, and production HSTS. Security logging
redacts wallet secrets, credentials, signatures, transaction payloads, and
credential-bearing PostgreSQL URLs.
