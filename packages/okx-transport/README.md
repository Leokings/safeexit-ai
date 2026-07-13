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

The bridge does not submit an ASP listing and does not claim that an Agentic
Wallet can sign for a separate compromised EOA. Native-asset recovery remains
blocked.
