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

## Local X Layer EIP-7702 route

`LocalEip7702RescueRuntime` is the fallback when a browser wallet does not expose
a documented raw EIP-7702 authorization method. It does not accept a private
key, seed phrase, keystore, or serialized signature. A local process may inject
an existing Viem `LocalAccount` into `ViemLocalEip7702SourceSigner`. The
operator canary instead uses `requestEip7702SourceSignerFromExtension`, which
receives two package-bound authorizations from the SafeExit Source Signer and
wraps them in a non-serializable, one-use signer port. The raw key remains
inside the extension popup.

The runtime performs this fixed sequence:

1. Recheck the confirmed source, destination, X Layer chain, source nonce,
   independently pinned factory address/runtime hash, predicted CREATE2
   address, and incident delegate immutables. A server-supplied factory
   commitment cannot replace the buyer runtime's local pin.
2. Let a fresh capped temporary payer, funded by the destination, deploy the
   incident delegate when it is absent.
3. Ask the local source signer for one chain-bound delegation authorization and
   its nonce-consecutive zero-address clearing authorization.
4. Have the temporary payer simulate and submit each fixed rescue action. The
   first transaction carries the delegation; later isolated actions call the
   already delegated source. The source pays no gas.
5. Submit and confirm the clearing transaction from the same temporary payer
   even when a rescue action reverts or receipt handling fails.
6. Return unused temporary gas to the destination.

Only native, ERC-20, ERC-721, ERC-1155, ERC-20 approval revocation, and NFT
operator revocation action shapes are accepted. There is no arbitrary-call
field. Native recovery uses the complete live source balance because the
destination pays the outer transaction gas.

The previously deployed V1 factory remains historical evidence only. The
fixed-recipient, temporary-payer factory is bytecode-pinned as
`XLAYER_SAFEEXIT_EIP7702_FACTORY_V2`:

- Address: `0x115C0340040C68bDc68E1890DA984575E49814e5`
- Runtime hash:
  `0x0f8beb374fbb87b0a1100b2c25dd649d897a76da1563e8b6cd885a24ac34dc7f`
- Deployment transaction:
  `0x5c0cb9bd876b8c86236b60098e30268242d5ffef4ba4ae924f8051a29eb2a154`

The hosted X Layer website now emits this package and exposes the route only
when deterministic scanning, planning, fresh simulation, factory verification,
and source-state checks all pass. The production Source Signer independently
checks the predicted delegate through both pinned official X Layer RPCs before
showing the signing review. Live type-4 simulation, no-value canary evidence,
and a successful V2 mainnet rescue are recorded in
[`EIP7702_CANARY_EVIDENCE.md`](../../EIP7702_CANARY_EVIDENCE.md).

The route uses the public X Layer mempool, leaves the source key compromised,
and has internal review but no independent external audit. It must be treated
as best effort, and the source wallet must not be reused after rescue.
