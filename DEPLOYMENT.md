# SAFEEXIT Deployment

This repository is ready to host the web dashboard and the provider-neutral
agent job API. The hosted service is intentionally review-only: it replays the
fixed developer-created demo fixture and never signs or broadcasts a
production transaction.

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
SAFEEXIT_DEMO_MODE=HOSTED_REPLAY
SAFEEXIT_AGENT_MODE=HOSTED_REPLAY
SAFEEXIT_AGENT_STORE=DATABASE
SAFEEXIT_AGENT_API_KEY=<at-least-32-random-characters>
SAFEEXIT_RATE_LIMIT_MAX_REQUESTS=20
SAFEEXIT_RATE_LIMIT_WINDOW_MS=60000
```

`SAFEEXIT_AGENT_API_KEY` is a temporary server-to-server credential for the
SAFEEXIT API. It is not an OKX wallet secret and must never have a
`NEXT_PUBLIC_` prefix.

### Live read-only production mode

Do not switch the deployment until all credentials have been added as encrypted
Vercel environment variables:

```text
SAFEEXIT_AGENT_MODE=LIVE_READONLY
OKX_WEB3_API_KEY=<OKX developer API key>
OKX_WEB3_SECRET_KEY=<OKX developer secret key>
OKX_WEB3_PASSPHRASE=<OKX developer passphrase>
XLAYER_MAINNET_RPC_URL=<dedicated HTTPS X Layer RPC URL>
XLAYER_TESTNET_RPC_URL=<dedicated HTTPS X Layer testnet RPC URL>
```

Create the OKX credentials in the official Onchain OS developer portal. Never
commit them, paste them into an agent conversation, add a `NEXT_PUBLIC_` prefix,
or expose them to browser code. `/api/ready` fails closed in `LIVE_READONLY`
mode when the OKX credentials or dedicated mainnet RPC are missing, and it
verifies an RPC block read before reporting ready.

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
POST /api/agent/jobs/{id}/monitor
GET  /api/agent/jobs/{id}
```

Analysis, planning, simulation, and monitoring accept the strict body
`{ "schemaVersion": "safeexit-agent-api-v1" }`.

## 5. Connect OKX.AI from official tooling

The repository does not claim that the SAFEEXIT API schema is an OKX wire
format. Registration, Agentic Wallet setup, marketplace metadata, escrow,
service discovery, and any A2A transport mapping must be completed with the
current official OKX.AI and Onchain OS tooling.

Use the hosted dashboard URL as the human review handoff and map an OKX service
request into the SAFEEXIT lifecycle only after confirming the official request
and response contract. Keep `packages/agent-service/src/official-boundaries.ts`
marked `OFFICIAL_DOCS_REQUIRED` until that adapter has tests against the
official contract.

Never provide an OKX prompt or agent with a seed phrase or private key. The
user-controlled signing integration remains future work and the hosted replay
stops at `WAITING_FOR_USER`.

## Current production limitations

- Hosted scanning and simulation are verified fixture replays unless the agent
  is explicitly switched to `LIVE_READONLY`.
- Only the fixed local developer incident is accepted by the hosted analyzer.
- No production wallet signing, relayer, private transaction, paymaster,
  Permit2, protocol withdrawal, or OKX execution integration is enabled.
- The in-process rate limiter is defense in depth only. Configure an edge or
  shared rate limiter before accepting untrusted public traffic at scale.
- Recovery remains best effort because a blockchain cannot distinguish two
  parties holding the same EOA private key.
