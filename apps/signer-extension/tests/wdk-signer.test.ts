import { hexToBytes, zeroAddress } from "viem";
import { recoverAuthorizationAddress } from "viem/utils";
import { describe, expect, it } from "vitest";

import {
  LocalKeyInputError,
  takeEphemeralPrivateKeyBytes,
} from "../src/local-key";
import {
  createEip7702ExtensionSigningResult,
  eip7702ExtensionReviewSchema,
} from "../src/protocol";
import {
  SAFEEXIT_WDK_SIGNER_BACKEND,
  WdkEip7702SourceSigner,
  WdkSignerError,
} from "../src/wdk-signer";

const sourcePrivateKey =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const sourceAddress = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const delegateAddress = "0x3000000000000000000000000000000000000003";
const destinationAddress = "0x2000000000000000000000000000000000000002";
const expiresAt = "2026-07-25T10:10:00.000Z";
const now = new Date("2026-07-25T10:00:00.000Z");

function policy() {
  return {
    chainId: 196,
    sourceAddress,
    delegateAddress,
    sourceNonce: 7,
  } as const;
}

function review() {
  return eip7702ExtensionReviewSchema.parse({
    schemaVersion: "safeexit-extension-review-v1",
    packageId: "package:wdk:test",
    networkName: "X Layer",
    chainId: 196,
    sourceAddress,
    destinationAddress,
    factoryAddress: "0x115C0340040C68bDc68E1890DA984575E49814e5",
    delegateAddress,
    planHash: `0x${"11".repeat(32)}`,
    expiresAt,
    actions: [
      {
        index: 0,
        actionId: "action:wdk:test",
        label: "Transfer ERC-20",
        asset: "0x4000000000000000000000000000000000000004",
        counterparty: destinationAddress,
        tokenId: "0",
        amount: "1000000",
      },
    ],
    delegationAuthorization: {
      chainId: 196,
      address: delegateAddress,
      nonce: 7,
    },
    clearingAuthorization: {
      chainId: 196,
      address: zeroAddress,
      nonce: 8,
    },
    destinationConnectsToExtension: false,
    privateCredentialsAccepted: false,
  });
}

describe("WDK EIP-7702 source signer", () => {
  it("signs only the delegation and clearing sequence, then disposes", async () => {
    const privateKeyBytes = hexToBytes(sourcePrivateKey);
    const signer = await WdkEip7702SourceSigner.takeOwnership({
      privateKeyBytes,
      policy: policy(),
    });

    expect(SAFEEXIT_WDK_SIGNER_BACKEND).toBe(
      "@tetherto/wdk-wallet-evm@1.0.0-beta.16",
    );
    expect(await signer.getAddress()).toBe(sourceAddress);

    const delegation = await signer.signAuthorization({
      chainId: 196,
      address: delegateAddress,
      nonce: 7,
    });
    expect(
      await recoverAuthorizationAddress({ authorization: delegation }),
    ).toBe(sourceAddress);
    expect(signer.state).toBe("DELEGATION_SIGNED");

    const clearing = await signer.signAuthorization({
      chainId: 196,
      address: zeroAddress,
      nonce: 8,
    });
    expect(
      await recoverAuthorizationAddress({ authorization: clearing }),
    ).toBe(sourceAddress);
    expect(signer.state).toBe("DISPOSED");
    expect([...privateKeyBytes]).toEqual(new Array(32).fill(0));
    await expect(signer.getAddress()).rejects.toMatchObject({
      code: "SIGNER_DISPOSED",
    });
  });

  it("rejects chain-wide and arbitrary delegate authorizations", async () => {
    const privateKeyBytes = hexToBytes(sourcePrivateKey);
    const signer = await WdkEip7702SourceSigner.takeOwnership({
      privateKeyBytes,
      policy: policy(),
    });

    await expect(
      signer.signAuthorization({
        chainId: 0,
        address: delegateAddress,
        nonce: 7,
      }),
    ).rejects.toMatchObject({
      code: "AUTHORIZATION_OUT_OF_SCOPE",
    });
    await expect(
      signer.signAuthorization({
        chainId: 196,
        address: "0x4000000000000000000000000000000000000004",
        nonce: 7,
      }),
    ).rejects.toMatchObject({
      code: "AUTHORIZATION_OUT_OF_SCOPE",
    });

    signer.dispose();
    expect([...privateKeyBytes]).toEqual(new Array(32).fill(0));
  });

  it("rejects a key that does not control the committed source and wipes it", async () => {
    const privateKeyBytes = hexToBytes(sourcePrivateKey);
    await expect(
      WdkEip7702SourceSigner.takeOwnership({
        privateKeyBytes,
        policy: {
          ...policy(),
          sourceAddress: "0x1000000000000000000000000000000000000001",
        },
      }),
    ).rejects.toMatchObject({
      code: "SOURCE_MISMATCH",
    });
    expect([...privateKeyBytes]).toEqual(new Array(32).fill(0));
  });

  it("does not serialize the signer or its key material", async () => {
    const privateKeyBytes = hexToBytes(sourcePrivateKey);
    const signer = await WdkEip7702SourceSigner.takeOwnership({
      privateKeyBytes,
      policy: policy(),
    });

    expect(JSON.stringify(signer)).toBe("{}");
    expect(JSON.stringify(signer)).not.toContain(sourcePrivateKey.slice(2));
    signer.dispose();
  });

  it("uses redacted errors that never include supplied key bytes", async () => {
    const privateKeyBytes = new Uint8Array(31).fill(0xab);
    let failure: unknown;
    try {
      await WdkEip7702SourceSigner.takeOwnership({
        privateKeyBytes,
        policy: policy(),
      });
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(WdkSignerError);
    expect(String(failure)).not.toContain("ab".repeat(31));
    expect([...privateKeyBytes]).toEqual(new Array(31).fill(0));
  });

  it("rejects an unexpected runtime key type without throwing an unredacted TypeError", async () => {
    await expect(
      WdkEip7702SourceSigner.takeOwnership({
        privateKeyBytes: "not-key-bytes" as unknown as Uint8Array,
        policy: policy(),
      }),
    ).rejects.toMatchObject({
      code: "INVALID_POLICY",
    });
  });

  it("creates a verified same-source signing result", async () => {
    const privateKeyBytes = hexToBytes(sourcePrivateKey);
    const signer = await WdkEip7702SourceSigner.takeOwnership({
      privateKeyBytes,
      policy: policy(),
    });
    const delegation = await signer.signAuthorization({
      chainId: 196,
      address: delegateAddress,
      nonce: 7,
    });
    const clearing = await signer.signAuthorization({
      chainId: 196,
      address: zeroAddress,
      nonce: 8,
    });

    const result = await createEip7702ExtensionSigningResult({
      reviewValue: review(),
      authorizationsValue: { delegation, clearing },
      now,
    });
    expect(result).toMatchObject({
      packageId: "package:wdk:test",
      sourceAddress,
      destinationAddress,
      destinationPaysGas: true,
      privateCredentialsIncluded: false,
    });
  });

  it("rejects a tampered signed authorization pair", async () => {
    const privateKeyBytes = hexToBytes(sourcePrivateKey);
    const signer = await WdkEip7702SourceSigner.takeOwnership({
      privateKeyBytes,
      policy: policy(),
    });
    const delegation = await signer.signAuthorization({
      chainId: 196,
      address: delegateAddress,
      nonce: 7,
    });
    const clearing = await signer.signAuthorization({
      chainId: 196,
      address: zeroAddress,
      nonce: 8,
    });

    await expect(
      createEip7702ExtensionSigningResult({
        reviewValue: review(),
        authorizationsValue: {
          delegation,
          clearing: { ...clearing, nonce: 9 },
        },
        now,
      }),
    ).rejects.toThrow(
      "The signed EIP-7702 authorizations do not match the staged review.",
    );
  });

  it("clears the private-key input before returning bytes", () => {
    const input = { value: sourcePrivateKey };
    const bytes = takeEphemeralPrivateKeyBytes(input);
    expect(input.value).toBe("");
    expect(bytes).toHaveLength(32);
    bytes.fill(0);
  });

  it("clears invalid private-key input without reflecting it in errors", () => {
    const input = { value: "not-a-private-key" };
    expect(() => takeEphemeralPrivateKeyBytes(input)).toThrow(
      LocalKeyInputError,
    );
    expect(input.value).toBe("");
  });
});
