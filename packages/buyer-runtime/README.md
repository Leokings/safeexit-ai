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

## Local EIP-7702 route under test

`LocalEip7702RescueRuntime` is the fallback when a browser wallet does not expose
a documented raw EIP-7702 authorization method. It does not accept a private
key, seed phrase, keystore, or serialized signature. Instead, the buyer's local
process injects an existing Viem `LocalAccount` object into
`ViemLocalEip7702SourceSigner`; that object and both signed authorizations stay
inside the process.

The runtime performs this fixed sequence:

1. Recheck the confirmed source, destination, X Layer chain, source nonce,
   independently pinned factory address/runtime hash, predicted CREATE2
   address, and incident delegate immutables. A server-supplied factory
   commitment cannot replace the buyer runtime's local pin.
2. Let the destination deploy the incident delegate when it is absent and pay
   that deployment gas.
3. Ask the local source signer for one chain-bound delegation authorization and
   its nonce-consecutive zero-address clearing authorization.
4. Have the destination simulate and submit each fixed rescue action. The first
   transaction carries the delegation; later isolated actions call the already
   delegated source. The source pays no gas.
5. Submit and confirm the clearing transaction from the destination even when a
   rescue action reverts or post-submission receipt handling fails.

Only native, ERC-20, ERC-721, ERC-1155, ERC-20 approval revocation, and NFT
operator revocation action shapes are accepted. There is no arbitrary-call
field. Native recovery uses the complete live source balance because the
destination pays the outer transaction gas.

The permissionless X Layer factory is deployed and bytecode-pinned as
`XLAYER_SAFEEXIT_EIP7702_FACTORY_V1`:

- Address: `0xe35964050279262449e71CBf36c86b6fFb5874e5`
- Runtime hash:
  `0x0641a98eac8a123bb898f848ff3c04fb8a9e7f42647f48c7838a4a6e7fee02cc`
- Deployment transaction:
  `0x7e44b0ccfa0e649376f413a43424597fe619d270a8baefc21560449c62a00676`

This runtime remains implementation-under-test. The hosted website and agent
API do not emit this package or expose an EIP-7702 execution button. Production
activation still requires a private-submission policy, independent security
review, and an explicit activation decision. Live type-4 simulation and the
no-value X Layer canary are recorded in
[`EIP7702_CANARY_EVIDENCE.md`](../../EIP7702_CANARY_EVIDENCE.md).
