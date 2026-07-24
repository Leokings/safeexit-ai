# X Layer EIP-7702 No-Value Canary Evidence

Date: 2026-07-23

Status: completed on X Layer mainnet with a fixed no-value action. The hosted
EIP-7702 route remains `IMPLEMENTATION_TESTING` and `executable: false`.

## Scope

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

## Activation Decision

This canary proves the fixed X Layer mechanism can:

1. Fund a local destination signer.
2. Deploy an incident-bound delegate.
3. Simulate and submit a destination-paid type-4 transaction.
4. Submit a consecutive clearing authorization.
5. Prove the source is empty and undelegated.
6. Return unused gas.

It does not prove private submission behavior against an active attacker,
support for arbitrary assets, or production incident operations. Production
activation therefore remains blocked pending the private-submission policy,
independent security review, and an explicit route activation decision.
