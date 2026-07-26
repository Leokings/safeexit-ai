# SafeExit Source Signer

This workspace contains the browser-extension boundary for SafeExit's direct,
destination-paid EIP-7702 route.

## Current state

The extension implements the local, one-session EIP-7702 authorization signer
used by SafeExit's X Layer V2 recovery route.

It currently:

- loads only on `https://safeexit.xyz` in the production build;
- validates the complete EIP-7702 signing package;
- pins the X Layer SafeExit factory address and runtime bytecode hash;
- checks the factory bytecode and predicted delegate through both pinned
  official X Layer RPC endpoints before staging a review;
- derives the chain-specific delegation and clearing authorization requests;
- stages only the validated package metadata in `chrome.storage.session`;
- shows the full source, destination, factory, delegate, plan hash, actions,
  expiry, and both authorization nonces in the extension popup;
- requires an authority confirmation and the destination-address suffix;
- accepts one 32-byte source private key only inside the extension popup;
- pins `@tetherto/wdk-wallet-evm@1.0.0-beta.16`;
- verifies that the signer controls the committed source;
- signs only the X Layer delegation at nonce `N` and zero-address clearing at
  nonce `N+1`;
- rejects global-chain, arbitrary-delegate, arbitrary-nonce, and repeated
  authorizations;
- independently recovers the source from every signature; and
- returns only the verified signed authorizations to the originating SafeExit
  tab before deleting the staged session.

The key input is cleared before asynchronous signing begins. The mutable key
byte buffer is zeroed when WDK is disposed and again by the popup cleanup
path. JavaScript cannot guarantee immediate physical erasure of every
temporary immutable string or engine-managed memory page; garbage collection
is outside the extension's control. Use a clean browser profile on a trusted
machine, disable password-manager capture for the canary, and never enter a
seed phrase.

The extension does not currently:

- receive a credential from the website, content script, or SafeExit backend;
- accept seed phrases or keystores;
- connect the destination wallet;
- broadcast a transaction; or
- move assets.

The shared buyer-runtime bridge, localhost canary, and hosted web application
send signing packages to the extension and consume its signed-result event.

## Build and load locally

Run one command at a time from the repository root:

```powershell
npm.cmd run typecheck --workspace @safeexit/signer-extension
npm.cmd run test --workspace @safeexit/signer-extension
npm.cmd run build:dev --workspace @safeexit/signer-extension
```

Then open `chrome://extensions`, enable Developer mode, select **Load
unpacked**, and choose:

```text
apps/signer-extension/dist
```

`build:dev` uses the explicit development manifest with the fixed localhost
origins. The default `build` command emits the production manifest, which has
no localhost content-script access.

## WDK verification

The focused test uses only the public Anvil fixture key:

```powershell
npm.cmd run test --workspace @safeexit/signer-extension
```

It verifies source recovery, exact authorization scope, chain binding,
automatic disposal, buffer zeroing, non-serialization, redacted errors,
session-schema credential rejection, and tampered-signature rejection. See
`WDK_SIGNER_CANARY.md` for the current evidence and remaining blockers.

## Release boundary

The extension is X Layer-only. It signs no messages, typed data, or
transactions other than the exact delegation-and-clearing authorization pair.
The destination wallet never connects to the extension. The hosted page funds
a fresh capped temporary payer, performs fresh simulations, submits the fixed
type-4 sequence, verifies canonical receipts, clears delegation, and returns
unused gas.

The route is public-mempool, WDK remains beta, and the contracts and extension
have not received an independent external audit. Store distribution requires
its own extension-package review; until then, the audited unpacked build must
be installed directly by the operator.
