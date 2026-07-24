import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { network } from "hardhat";
import {
  encodeAbiParameters,
  getAddress,
  keccak256,
  parseEther,
  stringToHex,
  zeroAddress,
  type Address,
  type Hex,
} from "viem";

const FULL_BALANCE = (1n << 256n) - 1n;

type RescueAction = {
  kind: number;
  asset: Address;
  counterparty: Address;
  tokenId: bigint;
  amount: bigint;
};

const planParameter = [
  {
    name: "plan",
    type: "tuple[]",
    components: [
      { name: "kind", type: "uint8" },
      { name: "asset", type: "address" },
      { name: "counterparty", type: "address" },
      { name: "tokenId", type: "uint256" },
      { name: "amount", type: "uint256" },
    ],
  },
] as const;

function hashPlan(plan: readonly RescueAction[]): Hex {
  return keccak256(encodeAbiParameters(planParameter, [plan]));
}

describe("SafeExit7702RescueDelegate", async function () {
  const { viem } = await network.create();
  const publicClient = await viem.getPublicClient();
  const testClient = await viem.getTestClient();
  const wallets = await viem.getWalletClients();
  const chainId = await publicClient.getChainId();

  async function futureDeadline(offset = 3_600n): Promise<bigint> {
    return (await publicClient.getBlock()).timestamp + offset;
  }

  async function installDelegate(
    source: Address,
    destination: Address,
    plan: readonly RescueAction[],
    rescueLabel: string,
    deadline?: bigint,
  ) {
    const effectiveDeadline = deadline ?? await futureDeadline();
    const delegate = await viem.deployContract("SafeExit7702RescueDelegate", [
      BigInt(chainId),
      source,
      destination,
      effectiveDeadline,
      hashPlan(plan),
      keccak256(stringToHex(rescueLabel)),
    ]);
    const runtime = await publicClient.getCode({ address: delegate.address });
    assert.ok(runtime && runtime !== "0x");
    await testClient.setCode({ address: source, bytecode: runtime });
    return { delegate, deadline: effectiveDeadline };
  }

  it("moves the four asset standards and revokes committed approvals", async function () {
    const source = wallets[1]!;
    const destination = wallets[2]!;
    const operator = wallets[3]!;
    const token = await viem.deployContract("SafeExitTestERC2612");
    const nft = await viem.deployContract("SafeExitTestERC4494");
    const multiToken = await viem.deployContract("SafeExitTestERC1155");
    const tokenAmount = parseEther("125");
    const multiTokenAmount = 7n;
    const nativeAmount = parseEther("1");
    const tokenId = 1n;
    const multiTokenId = 42n;

    await token.write.faucet([source.account.address, tokenAmount]);
    await nft.write.faucet([source.account.address]);
    await multiToken.write.faucet([
      source.account.address,
      multiTokenId,
      multiTokenAmount,
    ]);
    await source.writeContract({
      address: token.address,
      abi: token.abi,
      functionName: "approve",
      args: [operator.account.address, tokenAmount],
    });
    await source.writeContract({
      address: nft.address,
      abi: nft.abi,
      functionName: "setApprovalForAll",
      args: [operator.account.address, true],
    });

    const plan = [
      {
        kind: 0,
        asset: zeroAddress,
        counterparty: destination.account.address,
        tokenId: 0n,
        amount: nativeAmount,
      },
      {
        kind: 1,
        asset: token.address,
        counterparty: destination.account.address,
        tokenId: 0n,
        amount: FULL_BALANCE,
      },
      {
        kind: 2,
        asset: nft.address,
        counterparty: destination.account.address,
        tokenId,
        amount: 1n,
      },
      {
        kind: 3,
        asset: multiToken.address,
        counterparty: destination.account.address,
        tokenId: multiTokenId,
        amount: FULL_BALANCE,
      },
      {
        kind: 4,
        asset: token.address,
        counterparty: operator.account.address,
        tokenId: 0n,
        amount: 0n,
      },
      {
        kind: 5,
        asset: nft.address,
        counterparty: operator.account.address,
        tokenId: 0n,
        amount: 0n,
      },
    ] as const satisfies readonly RescueAction[];

    const sourceNativeBefore = await publicClient.getBalance({
      address: source.account.address,
    });
    const { delegate } = await installDelegate(
      source.account.address,
      destination.account.address,
      plan,
      "all-supported-assets",
    );

    await destination.writeContract({
      address: source.account.address,
      abi: delegate.abi,
      functionName: "execute",
      args: [plan, [0n, 1n, 2n, 3n, 4n, 5n]],
    });

    assert.equal(
      await publicClient.getBalance({ address: source.account.address }),
      sourceNativeBefore - nativeAmount,
    );
    assert.equal(await token.read.balanceOf([source.account.address]), 0n);
    assert.equal(
      await token.read.balanceOf([destination.account.address]),
      tokenAmount,
    );
    assert.equal(
      await nft.read.ownerOf([tokenId]),
      getAddress(destination.account.address),
    );
    assert.equal(
      await multiToken.read.balanceOf([source.account.address, multiTokenId]),
      0n,
    );
    assert.equal(
      await multiToken.read.balanceOf([
        destination.account.address,
        multiTokenId,
      ]),
      multiTokenAmount,
    );
    assert.equal(
      await token.read.allowance([
        source.account.address,
        operator.account.address,
      ]),
      0n,
    );
    assert.equal(
      await nft.read.isApprovedForAll([
        source.account.address,
        operator.account.address,
      ]),
      false,
    );
    assert.equal(
      await publicClient.readContract({
        address: source.account.address,
        abi: delegate.abi,
        functionName: "executionBitmap",
      }),
      63n,
    );
  });

  it("rejects a non-destination caller and direct implementation execution", async function () {
    const source = wallets[4]!;
    const destination = wallets[5]!;
    const outsider = wallets[6]!;
    const token = await viem.deployContract("SafeExitTestERC2612");
    const amount = parseEther("10");
    await token.write.faucet([source.account.address, amount]);
    const plan = [
      {
        kind: 1,
        asset: token.address,
        counterparty: destination.account.address,
        tokenId: 0n,
        amount,
      },
    ] as const satisfies readonly RescueAction[];
    const { delegate } = await installDelegate(
      source.account.address,
      destination.account.address,
      plan,
      "destination-only",
    );

    await assert.rejects(
      outsider.writeContract({
        address: source.account.address,
        abi: delegate.abi,
        functionName: "execute",
        args: [plan, [0n]],
      }),
    );
    await assert.rejects(
      destination.writeContract({
        address: delegate.address,
        abi: delegate.abi,
        functionName: "execute",
        args: [plan, [0n]],
      }),
    );
    assert.equal(await token.read.balanceOf([source.account.address]), amount);
  });

  it("rejects substituted plans, expired plans, and action replay", async function () {
    const source = wallets[7]!;
    const destination = wallets[8]!;
    const token = await viem.deployContract("SafeExitTestERC2612");
    const amount = parseEther("20");
    await token.write.faucet([source.account.address, amount]);
    const plan = [
      {
        kind: 1,
        asset: token.address,
        counterparty: destination.account.address,
        tokenId: 0n,
        amount,
      },
    ] as const satisfies readonly RescueAction[];
    const { delegate } = await installDelegate(
      source.account.address,
      destination.account.address,
      plan,
      "substitution-replay",
    );
    const substituted = [{ ...plan[0], amount: amount - 1n }] as const;

    await assert.rejects(
      destination.writeContract({
        address: source.account.address,
        abi: delegate.abi,
        functionName: "execute",
        args: [substituted, [0n]],
      }),
    );
    await destination.writeContract({
      address: source.account.address,
      abi: delegate.abi,
      functionName: "execute",
      args: [plan, [0n]],
    });
    await assert.rejects(
      destination.writeContract({
        address: source.account.address,
        abi: delegate.abi,
        functionName: "execute",
        args: [plan, [0n]],
      }),
    );

    const expiredSource = wallets[9]!;
    const expiredDestination = wallets[10]!;
    const expiredToken = await viem.deployContract("SafeExitTestERC2612");
    await expiredToken.write.faucet([expiredSource.account.address, amount]);
    const expiredPlan = [
      {
        kind: 1,
        asset: expiredToken.address,
        counterparty: expiredDestination.account.address,
        tokenId: 0n,
        amount,
      },
    ] as const satisfies readonly RescueAction[];
    const { delegate: expiredDelegate } = await installDelegate(
      expiredSource.account.address,
      expiredDestination.account.address,
      expiredPlan,
      "expired-plan",
      await futureDeadline(60n),
    );
    await testClient.increaseTime({ seconds: 61 });

    await assert.rejects(
      expiredDestination.writeContract({
        address: expiredSource.account.address,
        abi: expiredDelegate.abi,
        functionName: "execute",
        args: [expiredPlan, [0n]],
      }),
    );
  });

  it("rejects fee-on-transfer behavior without consuming the action", async function () {
    const source = wallets[11]!;
    const destination = wallets[12]!;
    const token = await viem.deployContract("SafeExitTestFeeOnTransferERC2612");
    const amount = parseEther("100");
    await token.write.faucet([source.account.address, amount]);
    const plan = [
      {
        kind: 1,
        asset: token.address,
        counterparty: destination.account.address,
        tokenId: 0n,
        amount,
      },
    ] as const satisfies readonly RescueAction[];
    const { delegate } = await installDelegate(
      source.account.address,
      destination.account.address,
      plan,
      "fee-token",
    );

    await assert.rejects(
      destination.writeContract({
        address: source.account.address,
        abi: delegate.abi,
        functionName: "execute",
        args: [plan, [0n]],
      }),
    );
    assert.equal(await token.read.balanceOf([source.account.address]), amount);
    assert.equal(await token.read.balanceOf([destination.account.address]), 0n);
    assert.equal(
      await publicClient.readContract({
        address: source.account.address,
        abi: delegate.abi,
        functionName: "executionBitmap",
      }),
      0n,
    );
  });

  it("isolates a missing asset so another committed asset can still be rescued", async function () {
    const source = wallets[13]!;
    const destination = wallets[14]!;
    const missingToken = await viem.deployContract("SafeExitTestERC2612");
    const rescuableToken = await viem.deployContract("SafeExitTestERC2612");
    const amount = parseEther("80");
    await rescuableToken.write.faucet([source.account.address, amount]);
    const plan = [
      {
        kind: 1,
        asset: missingToken.address,
        counterparty: destination.account.address,
        tokenId: 0n,
        amount: FULL_BALANCE,
      },
      {
        kind: 1,
        asset: rescuableToken.address,
        counterparty: destination.account.address,
        tokenId: 0n,
        amount: FULL_BALANCE,
      },
    ] as const satisfies readonly RescueAction[];
    const { delegate } = await installDelegate(
      source.account.address,
      destination.account.address,
      plan,
      "partial-race",
    );

    await assert.rejects(
      destination.writeContract({
        address: source.account.address,
        abi: delegate.abi,
        functionName: "execute",
        args: [plan, [0n]],
      }),
    );
    await destination.writeContract({
      address: source.account.address,
      abi: delegate.abi,
      functionName: "execute",
      args: [plan, [1n]],
    });

    assert.equal(await rescuableToken.read.balanceOf([source.account.address]), 0n);
    assert.equal(
      await rescuableToken.read.balanceOf([destination.account.address]),
      amount,
    );
    assert.equal(
      await publicClient.readContract({
        address: source.account.address,
        abi: delegate.abi,
        functionName: "executionBitmap",
      }),
      2n,
    );
  });

  it("deploys the same incident configuration idempotently through CREATE2", async function () {
    const source = wallets[15]!;
    const destination = wallets[16]!;
    const factory = await viem.deployContract(
      "SafeExit7702RescueDelegateFactory",
    );
    const planHash = keccak256(stringToHex("factory-plan"));
    const rescueNonce = keccak256(stringToHex("factory-rescue"));
    const deadline = await futureDeadline();
    const args = [
      source.account.address,
      destination.account.address,
      deadline,
      planHash,
      rescueNonce,
    ] as const;
    const predicted = await factory.read.predictDelegate(args);

    await factory.write.deployDelegate(args);
    const firstRuntime = await publicClient.getCode({ address: predicted });
    assert.ok(firstRuntime && firstRuntime !== "0x");
    await factory.write.deployDelegate(args);
    assert.equal(await publicClient.getCode({ address: predicted }), firstRuntime);
  });
});
