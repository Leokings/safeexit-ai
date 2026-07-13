# SAFEEXIT OKX Transport Bridge

`@safeexit/okx-transport` is the provider-side handoff between the official OKX
A2A runtime and SAFEEXIT's deterministic agent service. It does not implement
OKX discovery, XMTP, payment, task acceptance, or delivery transactions.

## Trust boundary

The official runtime owns marketplace state and must not invoke SAFEEXIT work
before the task reaches `job_accepted`. The runtime then normalizes the accepted
task into `safeexit-okx-a2a-v1` and sends it to the authenticated SAFEEXIT
provider endpoint. This schema is a SAFEEXIT contract, not an OKX wire format.

Required task fields are:

- OKX job ID and provider agent ID
- source address, destination address, and chain ID
- the exact ownership statement exported as
  `SAFEEXIT_AUTHORIZATION_STATEMENT`

X Layer testnet tasks (`chainId: 1952`) additionally require an explicit
`assetManifest` accepts a bounded batch of ERC-20 contract addresses and
explicit ERC-721/ERC-1155 `collectionAddress` plus `tokenId` entries. SAFEEXIT
reads only those identified assets at a pinned block. Testnet requires the
manifest. Mainnet can merge it with OKX-backed ERC-20 discovery so explicitly
requested contracts are not omitted when an indexer does not return them.

The canonical manifest is committed into the persisted incident scope.
Reusing an OKX job ID with a different asset list is rejected by the same
idempotency guard that protects source, destination, and chain binding.

Unknown fields are rejected. Private keys, seed phrases, credentials,
signatures, and arbitrary calldata have no accepted field.

## Provider flow

1. `POST /api/agent/okx/prepare` creates or resumes an idempotent SAFEEXIT job,
   scans, plans, simulates, and returns a short-lived signing deliverable.
2. The official OKX runtime delivers that JSON to the buyer agent.
3. The source wallet signs only in the buyer's local signer. The destination
   wallet post-simulates and pays for settlement.
4. The buyer sends only `safeexit-buyer-report-v1` receipt data back through
   A2A. Source signatures are prohibited.
5. `POST /api/agent/okx/buyer-report` verifies task binding and onchain receipts,
   then returns the final completion deliverable.

Both endpoints use the existing server-only `SAFEEXIT_AGENT_API_KEY` bearer
credential. `SAFEEXIT_OKX_PROVIDER_AGENT_ID` pins requests to the registered ASP.

## Paid direct flow

`POST /api/agent/okx/prepare-paid` exposes the deterministic preparation
pipeline as a standardized paid API service. The official OKX x402 middleware
verifies and settles the `$0.10` payment on X Layer before returning the
resource. The public request uses `safeexit-okx-x402-v1`; it does not accept a
provider override, marketplace job ID, source signature, or credential.

The bridge derives its internal idempotency scope from `requestId` and the
configured provider identity, then returns
`safeexit-okx-x402-deliverable-v1`. The hosted route may attach a bounded
`incidentAnalysis` whose authority is explicitly `EXPLANATION_ONLY`; its
executable plan source is always `DETERMINISTIC`. Model failure falls back to
deterministic grounded output and cannot alter the signing package. This path
avoids negotiation, event polling, and file delivery. The agent-to-agent path
remains available for custom incident work.

Buyer integrations must invoke the endpoint directly and use a payment wallet
that is different from the provider payout address. SAFEEXIT rejects
self-payment credentials before settlement so an invalid test fails quickly
instead of entering the marketplace watch lifecycle.

The bridge does not submit an ASP listing and does not claim that an Agentic
Wallet can sign for a separate compromised EOA. Native-asset recovery remains
blocked.
