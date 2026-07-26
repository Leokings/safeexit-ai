# X Layer EIP-7702 Canary and V2 Rescue Evidence

Last updated: 2026-07-26

Status: the no-value canary and a V2 multi-asset rescue completed on X Layer
mainnet. The hosted route is internally verified and executable on chain `196`.
It is best effort, public-mempool, and not independently audited.

## V2 mainnet rescue

- Chain: X Layer (`196`, `0xc4`)
- Pinned V2 factory: `0x115C0340040C68bDc68E1890DA984575E49814e5`
- Factory runtime hash:
  `0x0f8beb374fbb87b0a1100b2c25dd649d897a76da1563e8b6cd885a24ac34dc7f`
- Factory deployment:
  `0x5c0cb9bd876b8c86236b60098e30268242d5ffef4ba4ae924f8051a29eb2a154`
- Source: `0x7aa9c21c5ece65e3eb64d8f17765882fe01b85a9`
- Fixed destination and funding wallet:
  `0xa2ccc58eee90df48565afb6f60d472ab70c237cf`

| Stage | Transaction |
| --- | --- |
| Temporary payer funding | `0x30345863c725bd41544c251d1d4d9afa711c2d3c7d1d333ae43d9fa436471e4c` |
| Incident delegate deployment | `0x16b1d7b8a4a51204aaf426e95250a3f6b65208bea6f14bcef0d99ff38f470d2c` |
| Delegated rescue action 1 | `0x994388784988abe6031c7a5d37d51d2179eaeb1889326df1cb9ce901c4fb5463` |
| Delegated rescue action 2 | `0xff6361a6cdec1ec7b28b87ca55382588fb57d14f142ec28ea0b58e7c0fbed645` |
| Zero-address delegation clearing | `0xcff539f8551a8da208abfad0893250f695184b0db5db90daecefceadacd710b9` |
| Unused gas refund | `0x360714d8bbfe45ed4eea50546ef9615624d67809c83ca66c8a7000616e550321` |

Post-execution reads verified that the source code was `0x`, both selected
source token balances were zero, and the destination received `966253` and
`843094` base units respectively. The temporary payer retained only the
bounded fee-reserve dust after refund.

The source key was entered only in the local Source Signer extension. The
extension signed the exact X Layer delegation and nonce-consecutive clearing
authorization, then disposed its WDK signer and zeroed the owned key buffer.
The page and server did not receive the source key.

## Historical V1 no-value canary

- Chain: X Layer (`196`, `0xc4`)
- Factory: `0xe35964050279262449e71CBf36c86b6fFb5874e5`
- Factory runtime hash:
  `0x0641a98eac8a123bb898f848ff3c04fb8a9e7f42647f48c7838a4a6e7fee02cc`
- Funding wallet: `0x63038a310a46AC61A59c1bC5eAD5fe41040eF38e`
- Fresh local destination: `0x09c0c293D7FF72902daDe26D9c8bCE76D0c4E17D`
- Fresh empty source: `0xb28bc7E3F14EB70C875f4b79f6c1fD0c7aDBa386`
- Incident delegate: `0x3A535d8aC4e6CC33c99fB3926391Ccf93E2a7c4b`
- Fixed action: revoke an already-zero allowance on the developer-created test
  token `0x299D0c59ff5cAEA7b5480fEE3650Eba88B9fb1cd`
- Temporary funding cap: `0.000160000008 OKB`

The source and destination private keys existed only in the operator tab's
memory. They were not sent to SAFEEXIT, persisted, logged, or inserted into a
prompt.

## Transactions

| Stage | Transaction |
| --- | --- |
| Temporary destination gas | `0x9c0f328a6633d7e9e42d2630d646e492a4c16841fc2c3d5df46b13aed8946172` |
| Incident delegate deployment | `0x9d31f836d7dae67bdff628945113bdb2f336842596e132c85b8bc922641b45f1` |
| Delegated type-4 canary | `0x1fc158304d7c7bf9a403cba7917fcb6768cecb4739036bee5e1df71b0c6c3f9a` |
| Type-4 delegation clearing | `0x6b3207105a33a755b34adfda152437a6d27378e2e288cc7667112e79d614ffe5` |
| Unused gas refund | `0x621ed65659dd158468e131dcb095401cba40f262b87427d3e50e6e9b40308c68` |

Independent RPC reads confirmed:

- Every receipt succeeded and its receipt block hash matched the current
  canonical block hash.
- Every receipt had more than the required 64 confirmations at verification.
- The delegated transaction is type `0x4`, sent by the destination to the
  source, with authorization chain ID `0xc4`, source nonce `0`, and delegate
  `0x3A535d8aC4e6CC33c99fB3926391Ccf93E2a7c4b`.
- The clearing transaction is type `0x4`, sent by the destination to the source,
  with authorization chain ID `0xc4`, source nonce `1`, and authorization
  address `0x0000000000000000000000000000000000000000`.
- Final source code is `0x`, proving the delegation was cleared.
- Final source nonce is `2`.
- Final source native balance is `0`.
- Final test-token allowance is `0`.
- The destination refunded `0.000118719525935976 OKB`.
- The destination residual is `0.000000042020002101 OKB`.

## Receipt Polling Correction

An earlier canary exposed a stale receipt observation from the RPC watcher. It
failed closed with `The EIP-7702 receipt block is no longer canonical`, did not
submit a type-4 source transaction, and refunded unused gas.

`ViemLocalEip7702DestinationTransport.waitForReceipt` now performs bounded,
explicit receipt and latest-block polling. After the confirmation threshold it
still verifies the receipt against the canonical block, refreshes the receipt,
and checks the exact raw authorization list. Regression tests cover delayed
confirmation and transient incomplete authorization reads.

## Activation decision

This canary proves the fixed X Layer mechanism can:

1. Fund a local destination signer.
2. Deploy an incident-bound delegate.
3. Simulate and submit a destination-paid type-4 transaction.
4. Submit a consecutive clearing authorization.
5. Prove the source is empty and undelegated.
6. Return unused gas.

Together with the V2 rescue, this proves the implemented X Layer flow can fund
a fresh capped payer, deploy a fixed-recipient delegate, execute committed
asset actions, clear delegation, and refund unused gas.

It does not prove private submission behavior against an active attacker,
universal token compatibility, or safety against a leaked source key racing
the rescue. The current route is therefore active only as an internally
verified, best-effort X Layer adapter. Private relay integration and an
independent external audit remain future hardening work.

## Read-Only Wallet Capability Evidence

The canary page now records a typed
`safeexit-eip5792-capability-evidence-v1` document from
`wallet_getCapabilities`. The document includes the checked wallet, chain,
timestamp, fail-closed assessment, and sanitized advertised capabilities.

Capability evidence is display-only. Unexpected signature, authorization,
raw-transaction, private-key, seed, or mnemonic-like fields are replaced with
`[REDACTED]` before display or copying. The evidence explicitly records that no
signature, authorization, raw transaction, private key, seed phrase, or
mnemonic is retained. Producing this evidence never changes whether the
separately verified V2 route is executable.
