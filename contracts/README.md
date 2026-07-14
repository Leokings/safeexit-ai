# SafeExit X Layer Mainnet Fixtures

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
