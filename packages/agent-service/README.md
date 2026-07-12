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
- `getDashboardUrl`: resolves a SAFEEXIT-owned dashboard URL through an injected
  locator. It is not an OKX marketplace URL.
- `monitorRescue`: reads signature, execution, and receipt observations through
  a monitor port. It has no signing or broadcasting capability.

## Conceptual A2A boundary

`ConceptualA2ARequest` and `ConceptualA2AResponse` are versioned SAFEEXIT data
contracts, not an assertion about an OKX wire protocol. They accept only public
wallet context and an ownership confirmation. Strict validation rejects raw
credentials and undeclared fields.

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
