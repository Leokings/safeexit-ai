# SAFEEXIT Agent Service

`@safeexit/agent-service` is a provider-neutral orchestration package. It does
not register an ASP, discover marketplace work, negotiate payment, control an
Agentic Wallet, or call an OKX endpoint.

## Lifecycle

The transition graph is strict:

```text
RECEIVED -> WAITING_FOR_SOURCE -> ANALYSING -> PLAN_READY
RECEIVED -----------------------> ANALYSING -> PLAN_READY
PLAN_READY -> WAITING_FOR_USER -> SIGNING -> EXECUTING
EXECUTING -> COMPLETED | PARTIAL | FAILED
```

Any non-terminal operational state can fail only where declared in
`ALLOWED_AGENT_SERVICE_TRANSITIONS`. Terminal jobs cannot transition again.

## Service methods

- `createIncident`: creates `RECEIVED`, then atomically enters
  `WAITING_FOR_SOURCE` when no complete incident was supplied.
- `analyseIncident`: invokes the injected deterministic scanner port and keeps
  the job in `ANALYSING` with its scoped scan.
- `generatePlan`: invokes the injected deterministic planner and enters
  `PLAN_READY`.
- `simulatePlan`: stores validated simulation results. A successful or partial
  simulation enters `WAITING_FOR_USER`; a fully failed simulation fails closed.
- `getSigningPackage`: returns one short-lived, allowlisted EIP-712 route for an
  action approved by the pinned simulation. It commits to the job, plan hash,
  source, destination, chain, block, action, amount or token ID, and simulation.
  It contains no private credential, signature, arbitrary calldata, or server
  execution capability.
- `getDashboardUrl`: resolves a SAFEEXIT-owned dashboard URL through an injected
  locator only when explicitly requested. Agent jobs are dashboardless by
  default, and this URL is not an OKX marketplace URL.
- `monitorRescue`: reads signature, execution, and receipt observations through
  a monitor port. It has no signing or broadcasting capability.

## Signing-package boundary

The signing package is a declarative contract between SAFEEXIT and a buyer-local
runtime. Supported schema routes are ERC-3009, ERC-2612, strict DAI-style permit,
and ERC-4494. The destination is the settlement executor and gas payer. Every
source authorization uses EIP-712 and must be requested from the source signer
locally.

The buyer runtime must independently render the committed source and
destination, obtain confirmation, request the source signature, perform the
required post-signature simulation, assemble only the declared operation
sequence, and submit from the destination wallet. Signatures must not be sent
back to SAFEEXIT. The repository does not yet contain that OKX Agentic Wallet or
wallet-extension runtime.

## Conceptual A2A boundary

`ConceptualA2ARequest` and `ConceptualA2AResponse` are versioned SAFEEXIT data
contracts, not an assertion about an OKX wire protocol. They accept only public
wallet context and an ownership confirmation. Strict validation rejects raw
credentials and undeclared fields. A conceptual response may identify a ready
signing package, while the dashboard URL remains optional.

## OKX integration status

The following remain `OFFICIAL_DOCS_REQUIRED` and `implemented: false`:

- ASP registration
- escrow
- Agentic Wallet
- marketplace
- service discovery

Official ASP documentation describes A2A as a negotiated service with escrow,
while the current Agent Seller payments page says escrow is coming soon. No
escrow behavior is implemented until the official integration path is verified
for the target hackathon environment.

Official references:

- [ASP introduction](https://web3.okx.com/onchainos/dev-docs/okxai/asp-introduction)
- [ASP registration](https://web3.okx.com/onchainos/dev-docs/okxai/registerasp)
- [A2A guide](https://web3.okx.com/onchainos/dev-docs/okxai/how-to-become-a2a)
- [Agentic Wallet](https://web3.okx.com/onchainos/dev-docs/wallet/agentic-wallet)
- [Agent Seller payments](https://web3.okx.com/onchainos/dev-docs/payments/agent-seller)
