# SAFEEXIT Buyer Runtime

`@safeexit/buyer-runtime` is the buyer-local half of SAFEEXIT. It consumes a
strict signing package, but it never sends source signatures or private wallet
credentials back to the SAFEEXIT ASP.

## Two-stage flow

1. `BuyerRescueRuntime.authorize` validates the package and an exact buyer
   confirmation, checks the active source account, requests the package's
   EIP-712 signatures, recovers every signer, and creates an opaque in-memory
   authorization handle.
2. The buyer switches to the destination wallet.
3. `BuyerRescueRuntime.execute` checks the destination and chain, requires
   EIP-5792 atomic capability for permit batches, runs the complete signed call
   sequence through a post-signature simulator, submits it, and waits for final
   transaction receipts.

The opaque handle is stored in a process-local `WeakMap`. Serializing it drops
the signatures and settlement calldata, and a serialized handle cannot be
executed. Handles are one-use after submission begins.

## Included adapters

- `Eip1193LocalSourceSigner` requests `eth_signTypedData_v4` from a local wallet.
- `EthSimulateV1AtomicSimulator` simulates all calls sequentially in one
  ephemeral block. Unsupported RPCs fail closed.
- `Eip1193DestinationWallet` uses one `eth_sendTransaction` for ERC-3009 or
  EIP-5792 `wallet_sendCalls` for atomic permit batches, then waits for receipts.

These are provider-neutral local adapters. They are not an OKX Agentic Wallet
server adapter and do not imply that an Agentic Wallet can sign for a separate
compromised source EOA. An OKX-specific destination adapter remains
official-docs-required until its typed contract-call and atomic-batch guarantees
are verified end to end.
