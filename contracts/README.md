# SafeExit Mainnet Contracts

## Permit settlement deployments

`SafeExitPermitSettlementV2` is deployed through the canonical CREATE2 proxy at
`0x4e59b44847b379578588920cA78FbF26c0B4956C`. Every supported chain uses the
same fixed creation bytecode and salt, so the settlement address is always:

```text
0x73E8A8d165EC9710aC27f91B0Df02975CC4a48d0
```

The exact runtime hash is chain-specific because OpenZeppelin EIP-712 embeds
the chain ID in immutable runtime slots. Verification therefore requires both
the shared template hash and the exact runtime hash recorded in that chain's
deployment manifest.

Generate or refresh every manifest without broadcasting:

```powershell
npm run contracts:prepare:settlement:all
```

Open the fixed-payload operator page for one chain:

```powershell
npm run contracts:serve:settlement:chain -- ethereum
```

Supported chain keys are `ethereum`, `bnb`, `polygon`, `arbitrum`, `optimism`,
`base`, `avalanche`, and `xlayer`. The page requires an explicit OKX Wallet
confirmation and cannot alter the factory, value, salt, or creation bytecode.
After confirmation, verify all deployed runtimes and EIP-712 domains:

```powershell
npm run contracts:verify:settlement:all
```

The verified production deployment transactions are:

| Chain | Deployment transaction |
| --- | --- |
| Ethereum | `0xd441db53e0db4150ab0da3c76bb50ec8e96f51bacc2d463f50af3035aefe9b7d` |
| BNB Smart Chain | `0x3bed1041bd2b01a969970c8dfe47d7d356b9ca624abe989f981580d0e6f192f5` |
| Polygon | `0x207aadbe431c80a6954e9c42e742c98d93189f4ffdf61df1dfcebd8641c796a8` |
| Arbitrum | `0x731e677b674be68fb18c2236f9c6c4fae0949141979f1538e4fec137f757589e` |
| Optimism | `0xa994fa0c83a9a4fb2cc810d8719dc648d4aef259b0c4fa090e0c37f08d106344` |
| Base | `0x602a3f55f71d51ddfe15bd13607c482213e97affe3e92afe29e4b4055064001e` |
| Avalanche | `0x7987b289367273c1ee102e7f1078ed8de77693ea212f47b91407184766e057ec` |
| X Layer | Existing deployment; runtime and immutable template verified in `deployments/xlayer-permit-settlement.json` |

The settlement contract is immutable, stateless apart from replay protection,
has no owner or upgrade path, and has not received an independent audit.

## X Layer mainnet fixtures

These contracts are public testing fixtures for SafeExit's destination-paid recovery routes. They are deployed on X Layer mainnet because production behavior must be tested against the production chain.

## Warning

- Every fixture is named `TEST ONLY - NO VALUE`.
- Every fixture is openly mintable.
- Fixture assets have no monetary value.
- Never present fixture assets as real tokens or NFTs.
- The contracts have no administrator, upgrade path, custody, or privileged withdrawal function.

## Routes

The verified addresses and runtime hashes are recorded in `deployments/xlayer-mainnet.json`:

- `SafeExitTestERC3009`: ERC-3009 `receiveWithAuthorization`.
- `SafeExitTestERC2612`: ERC-2612 `permit` plus `transferFrom`.
- `SafeExitTestDaiPermit`: DAI-style allow, `transferFrom`, and revoke.
- `SafeExitTestERC4494`: ERC-4494 NFT permit plus transfer.

The same manifest records xETH and xBTC as real X Layer assets that passed SafeExit's strict ERC-2612 capability checks. Real assets should only be tested with negligible amounts.

## Verification

```powershell
npm run contracts:verify:xlayer
```

Verification checks chain ID 196, the canonical CREATE2 factory runtime, compiler-declared immutable slots, deployed runtime code, EIP-712 domains, and route-specific capability methods.

## Faucet Calldata

Generate calldata for an ERC-20 fixture:

```powershell
npm run contracts:faucet-data:xlayer -- SafeExitTestERC3009 0xRecipient 100
```

Generate calldata for the ERC-4494 fixture:

```powershell
npm run contracts:faucet-data:xlayer -- SafeExitTestERC4494 0xRecipient
```

Submit faucet calls only from a wallet you control. The recipient should be the source wallet used for the SafeExit test. Signing and settlement still happen through the production SafeExit flow; the fixtures do not bypass its authorization checks.
