# SAFEEXIT Deployment

This repository is ready to host the optional web dashboard and the
provider-neutral agent job API. The hosted service exposes a narrowly scoped X
Layer mainnet destination-paid recovery path described below. Native OKB and
assets without a verified permit route remain non-executable.

The codebase also contains an opt-in `LIVE_READONLY` mode. It uses the official
OKX Wallet API to discover X Layer ERC-20 candidates, re-verifies balances with
pinned RPC reads, creates a deterministic standard-asset plan, and performs
current-state `eth_call` and gas-estimation preflight checks. It still does not
sign or broadcast transactions.

## 1. Create the hosted resources

1. Push this standalone repository to a private or public GitHub repository.
2. Import the repository into Vercel with the repository root as the project
   root. `vercel.json` supplies the monorepo build settings.
3. Provision PostgreSQL. A Vercel Marketplace PostgreSQL provider such as Neon
   is suitable; an external PostgreSQL service also works.
4. Add the production environment variables below in Vercel.

Do not place a private key, seed phrase, wallet keystore, raw signature, or
wallet credential in Vercel, PostgreSQL, GitHub, or an OKX service prompt.

## 2. Production environment

```text
DATABASE_URL=<pooled PostgreSQL URL>
DIRECT_URL=<direct PostgreSQL URL for migrations>
SAFEEXIT_PUBLIC_BASE_URL=https://<your-domain>
SAFEEXIT_AGENT_MODE=LIVE_READONLY
SAFEEXIT_AGENT_STORE=DATABASE
SAFEEXIT_AGENT_API_KEY=<at-least-32-random-characters>
SAFEEXIT_OKX_PROVIDER_AGENT_ID=<registered numeric ASP agent ID>
SAFEEXIT_AI_MODE=GATEWAY
SAFEEXIT_AI_MODEL=deepseek/deepseek-v4-flash
SAFEEXIT_AI_MAX_ESTIMATED_INPUT_TOKENS=12000
SAFEEXIT_AI_MAX_OUTPUT_TOKENS=256
SAFEEXIT_AI_TIMEOUT_MS=8000
SAFEEXIT_RATE_LIMIT_MAX_REQUESTS=20
SAFEEXIT_RATE_LIMIT_WINDOW_MS=60000
```

`SAFEEXIT_AGENT_API_KEY` is a temporary server-to-server credential for the
SAFEEXIT API. It is not an OKX wallet secret and must never have a
`NEXT_PUBLIC_` prefix.

`SAFEEXIT_OKX_PROVIDER_AGENT_ID` pins normalized handoffs to one registered ASP.
It is an identity number, not a wallet credential.

On Vercel, AI Gateway uses the deployment's OIDC identity, so the production
DeepSeek path does not require a separate LLM API key. Local development outside
Vercel requires the authentication method supported by the current AI Gateway
SDK. The model receives only the user question, the six allowlisted tool names,
and IDs already present in the validated incident. It cannot author calldata,
change a destination, add an action, sign, or broadcast. The limits above cap
estimated input, generated output, and request time. Failure falls back to the
deterministic grounded explanation, and successful usage is stored in
`AiUsageEvent`.

### Live read-only production mode

Do not switch the deployment until all credentials have been added as encrypted
Vercel environment variables:

```text
SAFEEXIT_AGENT_MODE=LIVE_READONLY
OKX_WEB3_API_KEY=<OKX developer API key>
OKX_WEB3_SECRET_KEY=<OKX developer secret key>
OKX_WEB3_PASSPHRASE=<OKX developer passphrase>
XLAYER_MAINNET_RPC_URL=<dedicated HTTPS X Layer RPC URL>
ETHEREUM_MAINNET_RPC_URL=<optional encrypted QuickNode endpoint>
BNB_MAINNET_RPC_URL=<optional encrypted QuickNode endpoint>
POLYGON_MAINNET_RPC_URL=<optional encrypted QuickNode endpoint>
ARBITRUM_MAINNET_RPC_URL=<optional encrypted QuickNode endpoint>
OPTIMISM_MAINNET_RPC_URL=<optional encrypted QuickNode endpoint>
BASE_MAINNET_RPC_URL=<optional encrypted QuickNode endpoint>
AVALANCHE_MAINNET_RPC_URL=<optional encrypted QuickNode endpoint>
```

Create the OKX credentials in the official Onchain OS developer portal. Never
commit them, paste them into an agent conversation, add a `NEXT_PUBLIC_` prefix,
or expose them to browser code. `/api/ready` fails closed in `LIVE_READONLY`
mode when the OKX credentials or dedicated mainnet RPC are missing, and it
verifies an RPC block read before reporting ready.

Every configured multichain endpoint is checked for HTTPS, expected chain ID,
and a current block number. These URLs may contain provider credentials and
must be entered as encrypted server-only Vercel variables. X Layer (chain 196,
the OKX network) is currently rescue-enabled. The other endpoints are
configuration-only until their scanner, planner, simulation, and settlement
adapters are verified; their presence must not be interpreted as execution
support.

Live discovery is intentionally partial. Native and OKX-discovered ERC-20
balances are verified by RPC. NFT discovery, approval discovery, Permit2,
airdrops, and protocol positions are not represented as absent; the scan is
marked `PARTIAL` until verified adapters cover them.

## 3. Apply the database migrations

After the production database variables are available locally, run once from
the repository root:

```powershell
npm run db:generate
npm run db:migrate:deploy
```

Do not run `prisma migrate dev` against production. Future releases should run
`npm run db:migrate:deploy` as an explicit protected release step before
promoting the deployment.

## 4. Verify the deployment

```powershell
Invoke-RestMethod https://<your-domain>/api/health
Invoke-RestMethod https://<your-domain>/api/ready
```

`/api/health` proves that the process responds. `/api/ready` also verifies the
enabled agent configuration and database connection.

The agent API uses the version `safeexit-agent-api-v1`:

```powershell
$headers = @{ Authorization = "Bearer $env:SAFEEXIT_AGENT_API_KEY" }
$body = @{
  schemaVersion = "safeexit-agent-api-v1"
  requestId = "manual-smoke-1"
  walletContext = @{
    chainId = 31337
    sourceAddress = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8"
    destinationAddress = "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65"
    authorizationConfirmed = $true
  }
} | ConvertTo-Json -Depth 4
$job = Invoke-RestMethod -Method Post -Headers $headers `
  -ContentType "application/json" -Body $body `
  https://<your-domain>/api/agent/jobs
```

Then call the job actions in order with a versioned JSON body:

```text
POST /api/agent/jobs/{id}/analyse
POST /api/agent/jobs/{id}/plan
POST /api/agent/jobs/{id}/simulate
POST /api/agent/jobs/{id}/signing-package
POST /api/agent/jobs/{id}/buyer-report
POST /api/agent/jobs/{id}/monitor
GET  /api/agent/jobs/{id}
```

The provider-side normalized A2A bridge exposes two additional authenticated
SAFEEXIT endpoints:

```text
POST /api/agent/okx/prepare
POST /api/agent/okx/buyer-report
```

The paid direct endpoint is separate:

```text
POST /api/agent/okx/prepare-paid
```

It is protected by the official OKX x402 Next.js wrapper, charges `$0.10` on
X Layer mainnet, and does not use `SAFEEXIT_AGENT_API_KEY`. Configure:

```text
SAFEEXIT_X402_MODE=MAINNET
SAFEEXIT_X402_PAY_TO_ADDRESS=0x<provider-owned-payout-wallet>
```

`OKX_WEB3_API_KEY`, `OKX_WEB3_SECRET_KEY`, and `OKX_WEB3_PASSPHRASE` are reused
server-side by the official facilitator client. An unpaid request returns
`402 Payment Required`; after payment, the same request is retried and returns
the deterministic signing package plus an explanation-only grounded incident
analysis. DeepSeek can select only an intent and known evidence IDs; the
scanner, plan, simulation, signing package, fixed destination, and plan hash
remain deterministic. Readiness reports
`paidAgentApi=configured:eip155:196:$0.10` only when this configuration is
complete.

Use a buyer wallet that differs from `SAFEEXIT_X402_PAY_TO_ADDRESS`. A buyer
cannot meaningfully test a paid service against its own payout address;
SAFEEXIT rejects that case with `409 X402_SELF_PAYMENT_UNSUPPORTED` before
verification or settlement. For the low-latency path, call this A2MCP endpoint
directly. Do not wrap the request in an A2A task or wait for the marketplace
task event stream unless a custom incident-response engagement is intended.

The request body is:

```json
{
  "schemaVersion": "safeexit-okx-x402-v1",
  "transportMode": "OKX_X402",
  "requestId": "buyer-generated-idempotency-key",
  "buyerAgentId": "5282",
  "service": "compromised-wallet-rescue",
  "walletContext": {
    "chainId": 196,
    "sourceAddress": "0xSource",
    "destinationAddress": "0xDestination"
  },
  "assetManifest": {
    "erc20TokenAddresses": ["0xToken"],
    "erc721Assets": [],
    "erc1155Assets": []
  },
  "authorization": {
    "statement": "I confirm that I am authorised to control and sign for this wallet.",
    "confirmedAt": "2026-07-13T13:00:00.000Z"
  }
}
```

`buyerAgentId` is optional. X Layer mainnet requires an explicit asset manifest.
Unknown fields, credentials, signatures, and arbitrary calldata are rejected.

These are not claimed OKX callback endpoints. After the official runtime emits
`job_accepted`, the provider runtime maps the accepted task fields into
`safeexit-okx-a2a-v1` and calls `prepare`. Repeated calls with the same OKX job
ID are idempotent; changing the wallet scope under an existing ID is rejected.
The returned signing-package JSON is delivered through the official A2A task
flow. After local buyer execution, only the receipt report is mapped into
`buyer-report`; source signatures must never be included.

The normalized bridge accepts X Layer mainnet (`196`) only. Every handoff must
declare one to eight ERC-20 contracts in
`assetManifest.erc20TokenAddresses` and explicit NFT entries in
`assetManifest.erc721Assets` or `assetManifest.erc1155Assets`. Mainnet merges
the explicit manifest with OKX-backed ERC-20 discovery and verifies all
submitted entries at the pinned RPC block.

Analysis, planning, simulation, and monitoring accept the strict body
`{ "schemaVersion": "safeexit-agent-api-v1" }`.

`signing-package` accepts the same version-only body. It returns one strict,
short-lived package for a successfully simulated action. The package contains
EIP-712 typed data and a declarative settlement sequence, not signatures,
private credentials, raw calldata, or an unrestricted call list. The buyer's
local runtime must re-confirm the fixed addresses, collect source signatures,
perform post-signature simulation, and submit settlement from the destination.

After confirmed destination submission, the buyer runtime may return only the
strict receipt report to `buyer-report`:

```json
{
  "schemaVersion": "safeexit-agent-api-v1",
  "report": {
    "schemaVersion": "safeexit-buyer-report-v1",
    "packageId": "signing-package-id",
    "jobId": "job-id",
    "incidentId": "incident-id",
    "planId": "plan-id",
    "planHash": "0x...",
    "actionId": "action-id",
    "route": "ERC2612_PERMIT_SETTLEMENT",
    "chainId": 196,
    "sourceAddress": "0x...",
    "destinationAddress": "0x...",
    "status": "COMPLETED",
    "simulationProviderId": "eth_simulateV1",
    "simulatedAt": "2026-07-13T00:00:00.000Z",
    "transactionHashes": ["0x..."],
    "completedAt": "2026-07-13T00:01:00.000Z"
  }
}
```

SAFEEXIT rejects reports outside the issued package scope and independently
loads successful chain receipts. A job completes only when the receipts contain
the exact committed ERC-20 or ERC-721 transfer from source to destination.
Signatures and settlement calldata are never returned to the hosted service.

The dashboard is optional and is not created with the job. Request it only for
a manual audit handoff:

```text
POST /api/agent/jobs/{id}/dashboard
```

## 5. Connect OKX.AI from official tooling

The repository does not claim that the SAFEEXIT API schema is an OKX wire
format. Registration, Agentic Wallet setup, marketplace metadata, escrow,
service discovery, and any A2A transport mapping must be completed with the
current official OKX.AI and Onchain OS tooling.

Map an OKX service request into the SAFEEXIT lifecycle only after confirming the
official request and response contract. Use the hosted dashboard only as an
optional human audit handoff. Keep
`packages/agent-service/src/official-boundaries.ts` marked
`OFFICIAL_DOCS_REQUIRED` until that adapter has tests against the official
contract.

The installed OKX runtime currently supplies encrypted A2A task sessions and
the marketplace lifecycle. SAFEEXIT's normalized bridge starts only after task
acceptance and leaves delivery/payment transitions to that runtime. It must not
process a buyer inquiry as an accepted work order.

Never provide an OKX prompt or agent with a seed phrase, private key, or raw
wallet credential. SAFEEXIT can prepare a signing package and remains at
`WAITING_FOR_USER` until the buyer-local runtime completes settlement. The
provider-neutral local signer, contract settlement, post-signature simulation,
and receipt-verification core are implemented. Mapping them to the official
OKX A2A transport and an Agentic Wallet destination adapter remains
official-docs-required and is not represented as connected.

## X Layer mainnet destination-paid recovery

For an incident created on chain ID `196`, the rescue dashboard scans an
incident-committed batch of ERC-20, ERC-721, and ERC-1155 assets and ranks
destination-paid routes. ERC-3009 requires
verified type-hash, EIP-712 domain, domain separator, and authorization-state
reads. ERC-2612 requires a verified EIP-712 domain and nonce read plus the
verified SAFEEXIT settlement contract. The source signs the token permit and a
destination-bound rescue authorization. The destination submits either
`receiveWithAuthorization` directly or one `settleERC2612` contract call and
pays all mainnet gas.

DAI-style routes require the exact legacy permit type hash, a version `1`
domain separator reconstructed from verified token metadata, and the pinned
holder nonce. Allow, revoke, and rescue-commitment signatures let the settlement
contract grant the boolean allowance, pull the exact scanned balance, and
revoke the allowance in the same EVM transaction.

ERC-4494 NFT routes additionally require pinned ownership, EIP-165 interface
support, a verifiable EIP-712 domain, and the token-specific nonce. The source
signs both the NFT permit and the SAFEEXIT destination commitment before the
destination submits one `settleERC4494` call.

The deterministic X Layer settlement address is
`0x964FDCfE0A0bCE568309f3f7D07ab08Fc8F93103`. Run
`npm run contracts:prepare:settlement:xlayer` to reproduce it and
`npm run contracts:verify:settlement:xlayer` after deployment. Production
preflight fails closed until code and all domain/type-hash constants verify at
that exact address. The contract is unaudited and must not be presented as
independently reviewed.

No server credential, relayer key, or private key is used. The short-lived
signature remains only in the browser tab. Source-funded transactions are
disabled in this flow. This is a real-money mainnet path and has not received
an independent security review; use remains best effort and permit-only.

## Current production limitations

- Hosted scanning and simulation are verified fixture replays unless the agent
  is explicitly switched to `LIVE_READONLY`.
- Only the fixed local developer incident is accepted by the hosted analyzer.
- Mainnet browser execution is limited to ERC-3009, signature-verified ERC-2612,
  strict DAI-style permits, or ERC-4494 destination-paid settlement through
  the user-controlled OKX Wallet. Relayer, private transaction, paymaster,
  Permit2, protocol withdrawal, and OKX server-side execution integrations are
  not enabled.
- The agent API can issue strict signing packages in `LIVE_READONLY`, and the
  provider-neutral buyer runtime can collect local signatures, assemble and
  post-simulate settlement, submit through EIP-1193, and return receipt-only
  reports. An OKX-native Agentic Wallet destination-execution adapter is not
  connected.
- The normalized provider bridge is connected to SAFEEXIT's hosted API, but the
  operator's OKX runtime still performs marketplace acceptance and encrypted
  delivery. SAFEEXIT does not expose a public unauthenticated webhook.
- Native OKB remains blocked. `@safeexit/adapters` defines the mandatory proof
  for EIP-7702 sponsorship and private atomic bundles, but exposes neither as
  executable until official X Layer integration details and an independent
  delegate-contract audit are available.
- Production request limits are stored atomically in PostgreSQL and fail closed
  if that shared store is unavailable. The x402 limit is evaluated before the
  payment middleware so a throttled request is not charged first. Vercel
  Firewall limits may be added as a second independent layer.
- Recovery remains best effort because a blockchain cannot distinguish two
  parties holding the same EOA private key.
