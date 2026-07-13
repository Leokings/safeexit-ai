import { describe, expect, it } from "vitest";

import { evmAddressSchema } from "@safeexit/shared";

import { SIGNING_PACKAGE_EIP712_TYPES, signingPackageSchema } from "../src";

const source = evmAddressSchema.parse("0x70997970C51812dc3A010C7d01b50e0d17dc79C8");
const destination = evmAddressSchema.parse("0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65");
const token = evmAddressSchema.parse("0x5FbDB2315678afecb367f032d93F642f64180aa3");
const planHash = `0x${"3".repeat(64)}`;

function daiPackage(): Record<string, unknown> {
  const request = (id: "source-allow-permit" | "source-revoke-permit", nonce: string, allowed: boolean) => ({
    id,
    signer: source,
    method: "EIP712",
    rpcMethod: "eth_signTypedData_v4",
    typedData: {
      primaryType: "Permit",
      types: {
        EIP712Domain: [...SIGNING_PACKAGE_EIP712_TYPES.EIP712Domain],
        Permit: [...SIGNING_PACKAGE_EIP712_TYPES.DaiPermit],
      },
      domain: {
        name: "Dai Stablecoin",
        version: "1",
        chainId: 1,
        verifyingContract: token,
      },
      message: {
        holder: source,
        spender: destination,
        nonce,
        expiry: "1783937040",
        allowed,
      },
    },
  });

  return {
    schemaVersion: "safeexit-signing-package-v1",
    packageId: "signing-package:test",
    jobId: "job:test",
    incidentId: "incident:test",
    planId: "plan:test",
    planHash,
    actionId: "action:transfer",
    route: "DAI_PERMIT_ATOMIC_BATCH",
    chainId: 1,
    sourceAddress: source,
    destinationAddress: destination,
    observedAtBlock: "123",
    expiresAt: "2026-07-13T10:04:00.000Z",
    tokenAddress: token,
    amount: "100",
    sourceSigningRequests: [
      request("source-allow-permit", "7", true),
      request("source-revoke-permit", "8", false),
    ],
    destinationSettlement: {
      executor: destination,
      payer: "DESTINATION",
      assembly: "BUYER_LOCAL_RUNTIME",
      atomicRequired: true,
      operations: ["PERMIT_DAI_ALLOW", "TRANSFER_FROM_ERC20", "PERMIT_DAI_REVOKE"],
    },
    simulation: {
      resultId: "simulation:test",
      providerId: "test-simulator",
      status: "SUCCEEDED",
      expiresAt: "2026-07-13T10:05:00.000Z",
    },
    policy: {
      sourceSignsLocally: true,
      destinationPaysSettlement: true,
      privateCredentialsAccepted: false,
      signaturesReturnedToSafeExit: false,
      arbitraryCallsAllowed: false,
      postSignatureSimulationRequired: true,
    },
  };
}

function eip3009Package(): Record<string, unknown> {
  return {
    schemaVersion: "safeexit-signing-package-v1",
    packageId: "signing-package:eip3009",
    jobId: "job:test",
    incidentId: "incident:test",
    planId: "plan:test",
    planHash,
    actionId: "action:transfer",
    route: "ERC3009_RECEIVE_WITH_AUTHORIZATION",
    chainId: 1,
    sourceAddress: source,
    destinationAddress: destination,
    observedAtBlock: "123",
    expiresAt: "2026-07-13T10:04:00.000Z",
    tokenAddress: token,
    amount: "100",
    sourceSigningRequests: [{
      id: "source-transfer-authorization",
      signer: source,
      method: "EIP712",
      rpcMethod: "eth_signTypedData_v4",
      typedData: {
        primaryType: "ReceiveWithAuthorization",
        types: {
          EIP712Domain: [...SIGNING_PACKAGE_EIP712_TYPES.EIP712Domain],
          ReceiveWithAuthorization: [
            ...SIGNING_PACKAGE_EIP712_TYPES.ReceiveWithAuthorization,
          ],
        },
        domain: {
          name: "USD Coin",
          version: "2",
          chainId: 1,
          verifyingContract: token,
        },
        message: {
          from: source,
          to: destination,
          value: "100",
          validAfter: "1783936800",
          validBefore: "1783937040",
          nonce: `0x${"8".repeat(64)}`,
        },
      },
    }],
    destinationSettlement: {
      executor: destination,
      payer: "DESTINATION",
      assembly: "BUYER_LOCAL_RUNTIME",
      atomicRequired: false,
      operations: ["RECEIVE_WITH_AUTHORIZATION"],
    },
    simulation: {
      resultId: "simulation:test",
      providerId: "test-simulator",
      status: "SUCCEEDED",
      expiresAt: "2026-07-13T10:05:00.000Z",
    },
    policy: {
      sourceSignsLocally: true,
      destinationPaysSettlement: true,
      privateCredentialsAccepted: false,
      signaturesReturnedToSafeExit: false,
      arbitraryCallsAllowed: false,
      postSignatureSimulationRequired: true,
    },
  };
}

describe("agent signing package", () => {
  it("accepts a tightly scoped DAI allow-transfer-revoke package", () => {
    const parsed = signingPackageSchema.parse(daiPackage());

    expect(parsed.route).toBe("DAI_PERMIT_ATOMIC_BATCH");
    expect(parsed.destinationSettlement.operations).toEqual([
      "PERMIT_DAI_ALLOW",
      "TRANSFER_FROM_ERC20",
      "PERMIT_DAI_REVOKE",
    ]);
  });

  it("rejects destination substitution", () => {
    const value = daiPackage();
    value.destinationSettlement = {
      ...(value.destinationSettlement as Record<string, unknown>),
      executor: source,
    };

    expect(signingPackageSchema.safeParse(value).success).toBe(false);
  });

  it("rejects a nested permit spender that differs from the confirmed destination", () => {
    const value = daiPackage();
    const requests = value.sourceSigningRequests as Array<Record<string, unknown>>;
    requests[0] = {
      ...requests[0],
      typedData: {
        ...(requests[0]?.typedData as Record<string, unknown>),
        message: {
          ...((requests[0]?.typedData as Record<string, unknown>).message as Record<string, unknown>),
          spender: source,
        },
      },
    };

    expect(signingPackageSchema.safeParse(value).success).toBe(false);
  });

  it("rejects malformed DAI nonce ordering", () => {
    const value = daiPackage();
    const requests = value.sourceSigningRequests as Array<Record<string, unknown>>;
    requests[1] = {
      ...requests[1],
      typedData: {
        ...(requests[1]?.typedData as Record<string, unknown>),
        message: {
          ...((requests[1]?.typedData as Record<string, unknown>).message as Record<string, unknown>),
          nonce: "9",
        },
      },
    };

    expect(signingPackageSchema.safeParse(value).success).toBe(false);
  });

  it("rejects credential and raw-calldata fields", () => {
    const withCredential = daiPackage();
    const requests = withCredential.sourceSigningRequests as Array<Record<string, unknown>>;
    requests[0] = { ...requests[0], privateKey: "never-accepted" };

    const withCalldata = daiPackage();
    withCalldata.destinationSettlement = {
      ...(withCalldata.destinationSettlement as Record<string, unknown>),
      calls: [{ to: token, data: "0xdeadbeef" }],
    };

    expect(signingPackageSchema.safeParse(withCredential).success).toBe(false);
    expect(signingPackageSchema.safeParse(withCalldata).success).toBe(false);
  });

  it("accepts an exact, short-lived ERC-3009 authorization", () => {
    expect(signingPackageSchema.safeParse(eip3009Package()).success).toBe(true);
  });

  it("rejects unsafe ERC-3009 amount, nonce, and validity windows", () => {
    const zeroAmount = eip3009Package();
    zeroAmount.amount = "0";

    const zeroNonce = eip3009Package();
    const zeroNonceRequest = (zeroNonce.sourceSigningRequests as Array<Record<string, unknown>>)[0];
    const zeroNonceTypedData = zeroNonceRequest?.typedData as Record<string, unknown>;
    zeroNonceTypedData.message = {
      ...(zeroNonceTypedData.message as Record<string, unknown>),
      nonce: `0x${"0".repeat(64)}`,
    };

    const invertedWindow = eip3009Package();
    const invertedRequest = (
      invertedWindow.sourceSigningRequests as Array<Record<string, unknown>>
    )[0];
    const invertedTypedData = invertedRequest?.typedData as Record<string, unknown>;
    invertedTypedData.message = {
      ...(invertedTypedData.message as Record<string, unknown>),
      validAfter: "1783937040",
    };

    expect(signingPackageSchema.safeParse(zeroAmount).success).toBe(false);
    expect(signingPackageSchema.safeParse(zeroNonce).success).toBe(false);
    expect(signingPackageSchema.safeParse(invertedWindow).success).toBe(false);
  });

  it("rejects a simulation that expires before the signing package", () => {
    const value = eip3009Package();
    value.simulation = {
      ...(value.simulation as Record<string, unknown>),
      expiresAt: "2026-07-13T10:03:59.000Z",
    };
    expect(signingPackageSchema.safeParse(value).success).toBe(false);
  });
});
