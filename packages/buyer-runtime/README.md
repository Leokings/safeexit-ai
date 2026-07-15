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
3. `BuyerRescueRuntime.execute` checks the destination and chain, assembles one
   fixed settlement-contract call, runs it through a post-signature simulator,
   submits it with `eth_sendTransaction`, waits for the chain-specific
   confirmation threshold, and verifies the receipt block is canonical before
   returning a final receipt.

The opaque handle is stored in a process-local `WeakMap`. Serializing it drops
the signatures and settlement calldata, and a serialized handle cannot be
executed. Handles are one-use after submission begins.

## Included adapters

- `Eip1193LocalSourceSigner` requests `eth_signTypedData_v4` from a local wallet.
- `EthSimulateV1AtomicSimulator` simulates the exact destination call in an
  ephemeral block. Unsupported RPCs fail closed.
- `Eip1193DestinationWallet` accepts only one non-batched call, submits it with
  `eth_sendTransaction`, and returns only a canonical, sufficiently confirmed
  receipt with explicit block and confirmation evidence.

These are provider-neutral local adapters. They are not an OKX Agentic Wallet
server adapter and do not imply that an Agentic Wallet can sign for a separate
compromised source EOA. An OKX-specific destination adapter remains
official-docs-required until its typed contract-call guarantees are verified
end to end.
