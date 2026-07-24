import {
  evmAddressSchema,
  type RescueAction,
} from "@safeexit/shared";
import {
  decodeFunctionData,
  parseTransaction,
  zeroAddress,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { recoverAuthorizationAddress } from "viem/utils";
import { describe, expect, it } from "vitest";

import {
  EIP7702_ACTION_KIND,
  EIP7702_FULL_BALANCE,
  buildEip7702AuthorizationPair,
  eip7702RescueDelegateAbi,
  eip7702RescueActionSchema,
  encodeEip7702ExecutionCall,
  hashEip7702RescuePlan,
  toEip7702RescueActions,
} from "../src";

const sourceAddress = evmAddressSchema.parse(
  "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
);
const destinationAddress = evmAddressSchema.parse(
  "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
);
const tokenAddress = evmAddressSchema.parse(
  "0x5FbDB2315678afecb367f032d93F642f64180aa3",
);

function transferAction(
  overrides: Partial<RescueAction> = {},
): RescueAction {
  return {
    id: "action:erc20",
    chainId: 196,
    sourceAddress,
    actionType: "TRANSFER_ERC20",
    parameters: {
      tokenAddress,
      recipient: destinationAddress,
      amount: "1000000",
    },
    dependencies: [],
    evidenceIds: ["asset:erc20"],
    expectedEffects: [
      {
        effectType: "ASSET_TRANSFERRED",
        assetId: "asset:erc20",
        description: "Move the supported token.",
      },
    ],
    riskLevel: "HIGH",
    supportStatus: "SUPPORTED",
    simulationStatus: "PASSED",
    ...overrides,
  } as RescueAction;
}

describe("EIP-7702 rescue adapter", () => {
  it("maps only simulated, supported actions committed to the destination", () => {
    const actions = toEip7702RescueActions(
      [transferAction()],
      sourceAddress,
      destinationAddress,
    );

    expect(actions).toEqual([
      {
        kind: EIP7702_ACTION_KIND.TRANSFER_ERC20,
        asset: tokenAddress,
        counterparty: destinationAddress,
        tokenId: 0n,
        amount: 1_000_000n,
      },
    ]);
    expect(hashEip7702RescuePlan(actions)).toMatch(/^0x[a-f0-9]{64}$/);
  });

  it("uses the full live native balance because the destination pays gas", () => {
    const nativeAction: RescueAction = {
      id: "action:native",
      chainId: 196,
      sourceAddress,
      actionType: "TRANSFER_NATIVE",
      parameters: {
        recipient: destinationAddress,
        maximumAmount: "1000000000000000000",
        amountStrategy: "MAX_MINUS_GAS_RESERVE",
      },
      dependencies: [],
      evidenceIds: ["asset:native"],
      expectedEffects: [{
        effectType: "ASSET_TRANSFERRED",
        assetId: "asset:native",
        description: "Move the native balance.",
      }],
      riskLevel: "CRITICAL",
      supportStatus: "SUPPORTED",
      simulationStatus: "PASSED",
    };

    expect(
      toEip7702RescueActions(
        [nativeAction],
        sourceAddress,
        destinationAddress,
      )[0]?.amount,
    ).toBe(EIP7702_FULL_BALANCE);
  });

  it("rejects unsimulated actions and destination substitution", () => {
    expect(() =>
      toEip7702RescueActions(
        [transferAction({ simulationStatus: "NOT_SIMULATED" })],
        sourceAddress,
        destinationAddress,
      ),
    ).toThrow("has not passed deterministic simulation");

    const otherDestination = evmAddressSchema.parse(
      "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
    );
    expect(() =>
      toEip7702RescueActions(
        [transferAction()],
        sourceAddress,
        otherDestination,
      ),
    ).toThrow("does not commit to the safe destination");
  });

  it("builds consecutive chain-bound delegation and clearing authorizations", () => {
    const pair = buildEip7702AuthorizationPair({
      chainId: 196,
      delegateAddress: tokenAddress,
      sourceNonce: 7,
    });

    expect(pair.delegation).toEqual({
      address: tokenAddress,
      chainId: 196,
      nonce: 7,
    });
    expect(pair.revocation).toEqual({
      address: zeroAddress,
      chainId: 196,
      nonce: 8,
    });
    expect(() =>
      buildEip7702AuthorizationPair({
        chainId: 43_114,
        delegateAddress: tokenAddress,
        sourceNonce: 7,
      }),
    ).toThrow("not enabled");
  });

  it("produces source-verifiable authorizations in a serialized type-4 transaction", async () => {
    const source = privateKeyToAccount(
      "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
    );
    const sponsor = privateKeyToAccount(
      "0x59c6995e998f97a5a0044976f7d7f9f57f8f149ca2a5c6bede10b1b2b9f2d9b8",
    );
    const pair = buildEip7702AuthorizationPair({
      chainId: 196,
      delegateAddress: tokenAddress,
      sourceNonce: 0,
    });
    const delegation = await source.signAuthorization(pair.delegation);
    const revocation = await source.signAuthorization(pair.revocation);

    expect(
      await recoverAuthorizationAddress({ authorization: delegation }),
    ).toBe(source.address);
    expect(
      await recoverAuthorizationAddress({ authorization: revocation }),
    ).toBe(source.address);

    const serialized = await sponsor.signTransaction({
      chainId: 196,
      type: "eip7702",
      to: source.address,
      nonce: 0,
      gas: 500_000n,
      maxFeePerGas: 1n,
      maxPriorityFeePerGas: 1n,
      value: 0n,
      data: "0x",
      authorizationList: [delegation],
    });
    const transaction = parseTransaction(serialized);

    expect(transaction.type).toBe("eip7702");
    expect(transaction.authorizationList).toHaveLength(1);
    expect(transaction.authorizationList?.[0]?.address.toLowerCase()).toBe(
      tokenAddress.toLowerCase(),
    );
  });

  it("strictly validates the fixed action representation", () => {
    expect(
      eip7702RescueActionSchema.safeParse({
        kind: EIP7702_ACTION_KIND.TRANSFER_ERC721,
        asset: tokenAddress,
        counterparty: destinationAddress,
        tokenId: 1n,
        amount: 1n,
        arbitraryCalldata: "0xdeadbeef",
      }).success,
    ).toBe(false);
  });

  it("encodes only a validated, ordered action subset", () => {
    const actions = toEip7702RescueActions(
      [transferAction()],
      sourceAddress,
      destinationAddress,
    );
    const calldata = encodeEip7702ExecutionCall(actions, [0]);
    const decoded = decodeFunctionData({
      abi: eip7702RescueDelegateAbi,
      data: calldata,
    });

    expect(decoded.functionName).toBe("execute");
    expect(calldata).toMatch(/^0x[0-9a-f]+$/);
    expect(() => encodeEip7702ExecutionCall(actions, [])).toThrow(
      "must be selected",
    );
    expect(() => encodeEip7702ExecutionCall(actions, [0, 0])).toThrow(
      "strictly increasing",
    );
    expect(() => encodeEip7702ExecutionCall(actions, [1])).toThrow(
      "out of bounds",
    );
  });
});
