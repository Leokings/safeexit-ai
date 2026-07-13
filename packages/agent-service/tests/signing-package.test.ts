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
});
