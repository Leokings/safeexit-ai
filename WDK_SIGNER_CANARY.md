# WDK EIP-7702 Signer Evidence

Date: 2026-07-25

Status: the bounded WDK authorization adapter, extension-only one-session
signing flow, shared page bridge, X Layer canary, and hosted V2 route are
implemented and directly tested.

## Pinned dependencies

- `@tetherto/wdk-wallet-evm@1.0.0-beta.16`
- `sodium-javascript@0.8.0`

WDK is still beta. Its browser crypto path uses `sodium-javascript` through
the `sodium-universal` browser mapping. SafeExit does not replace that mapping
with a custom crypto or memory-wiping shim.

Official WDK API:

- <https://docs.wdk.tether.io/sdk/wallet-modules/wallet-evm/api-reference/>

## Enforced authorization policy

One signer instance is bound to exactly:

- X Layer chain ID `196`;
- one checksummed source address;
- one incident delegate address;
- delegation nonce `N`; and
- clearing nonce `N + 1`.

The adapter refuses:

- chain ID `0` or any non-X Layer chain;
- a different delegate;
- an unexpected nonce;
- clearing before delegation;
- repeated signing after clearing; and
- a key that does not recover to the committed source.

The adapter exposes no message-signing or transaction-signing method.

## Local verification

The tests use only the public Anvil development key. They do not contain or
touch a production credential.

```powershell
npm.cmd run typecheck --workspace @safeexit/signer-extension
npm.cmd run test --workspace @safeexit/signer-extension
npm.cmd run build --workspace @safeexit/signer-extension
```

Verified results:

- both EIP-7702 authorizations recover to the expected source;
- the owned 32-byte key buffer is all zeroes after clearing;
- the signer object serializes as `{}`;
- invalid-key errors do not contain key bytes;
- the popup key-input helper clears valid and invalid input immediately;
- session storage rejects undeclared credential fields;
- tampered authorization pairs fail source recovery or package matching;
- all focused extension tests pass; and
- the WDK adapter bundles for the Chrome extension target.

## Credential lifetime

The selected canary bootstrap accepts one raw 32-byte private key only in the
extension popup. It never accepts a seed phrase or keystore. The key input is
cleared before asynchronous signing, the mutable byte buffer is transferred to
the WDK signer, and both the signer and popup cleanup paths zero that buffer.

JavaScript cannot guarantee immediate physical erasure of engine-managed
immutable strings or memory pages. Garbage collection is outside SafeExit's
control. The canary must therefore use a clean browser profile, a trusted
machine, a wallet created only for the canary, and disabled password-manager
capture. No production wallet should be used during this phase.

## Activation evidence and residual risk

The extension was loaded in Chromium, delivered authorizations only to the
originating SafeExit tab, completed the no-value X Layer mainnet canary, and
then completed a V2 multi-asset mainnet rescue with canonical clearing. The
hosted UI now uses this bridge.

The production build is restricted to `https://safeexit.xyz`; localhost is
present only in the explicit development manifest. Before staging a package,
the extension checks the pinned V2 factory bytecode and predicted incident
delegate through both configured official X Layer RPC endpoints.

WDK remains beta, the route uses the public mempool, and no independent
external audit has been completed. The source key remains compromised after
the rescue and the source wallet must not be reused.
