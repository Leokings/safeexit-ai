import { describe, expect, it } from "vitest";
import { encodeAbiParameters, encodeEventTopics, type Hex } from "viem";

import {
  SIGNING_PACKAGE_EIP712_TYPES,
  buyerExecutionReportSchema,
  signingPackageSchema,
  type AgentServiceJob,
} from "@safeexit/agent-service";
import { xLayerMainnetConfig } from "@safeexit/chain";

import {
  LiveBuyerExecutionVerifier,
  type BuyerReceiptClient,
} from "./live-buyer-report-verifier";

const source = "0x1111111111111111111111111111111111111111" as const;
const destination = "0x2222222222222222222222222222222222222222" as const;
const wrongDestination = "0x3333333333333333333333333333333333333333" as const;
const token = "0x4444444444444444444444444444444444444444" as const;
const txHash = `0x${"55".repeat(32)}` as Hex;
const planHash = `0x${"66".repeat(32)}`;
const expiresAt = "2026-07-13T10:04:00.000Z";
const deadline = String(Math.floor(Date.parse(expiresAt) / 1_000));

const transferAbi = [{
  type: "event",
  name: "Transfer",
  inputs: [
    { name: "from", type: "address", indexed: true },
    { name: "to", type: "address", indexed: true },
    { name: "value", type: "uint256", indexed: false },
  ],
}] as const;

const signingPackage = signingPackageSchema.parse({
  schemaVersion: "safeexit-signing-package-v1",
  packageId: "package:test",
  jobId: "job:test",
  incidentId: "incident:test",
  planId: "plan:test",
  planHash,
  actionId: "action:test",
  route: "ERC2612_PERMIT_ATOMIC_BATCH",
  chainId: 196,
  sourceAddress: source,
  destinationAddress: destination,
  observedAtBlock: "100",
  expiresAt,
  tokenAddress: token,
  amount: "100",
  sourceSigningRequests: [{
    id: "source-permit",
    signer: source,
    method: "EIP712",
    rpcMethod: "eth_signTypedData_v4",
    typedData: {
      primaryType: "Permit",
      types: {
        EIP712Domain: [...SIGNING_PACKAGE_EIP712_TYPES.EIP712Domain],
        Permit: [...SIGNING_PACKAGE_EIP712_TYPES.ERC2612Permit],
      },
      domain: {
        name: "Token",
        version: "1",
        chainId: 196,
        verifyingContract: token,
      },
      message: {
        owner: source,
        spender: destination,
        value: "100",
        nonce: "0",
        deadline,
      },
    },
  }],
  destinationSettlement: {
    executor: destination,
    payer: "DESTINATION",
    assembly: "BUYER_LOCAL_RUNTIME",
    atomicRequired: true,
    operations: ["PERMIT_ERC2612", "TRANSFER_FROM_ERC20"],
  },
  simulation: {
    resultId: "simulation:test",
    providerId: "simulator:test",
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
});

const report = buyerExecutionReportSchema.parse({
  schemaVersion: "safeexit-buyer-report-v1",
  packageId: signingPackage.packageId,
  jobId: signingPackage.jobId,
  incidentId: signingPackage.incidentId,
  planId: signingPackage.planId,
  planHash: signingPackage.planHash,
  actionId: signingPackage.actionId,
  route: signingPackage.route,
  chainId: signingPackage.chainId,
  sourceAddress: signingPackage.sourceAddress,
  destinationAddress: signingPackage.destinationAddress,
  status: "COMPLETED",
  simulationProviderId: "buyer-local",
  simulatedAt: "2026-07-13T10:00:30.000Z",
  transactionHashes: [txHash],
  completedAt: "2026-07-13T10:01:00.000Z",
});

function clientFor(recipient: `0x${string}`): BuyerReceiptClient {
  return {
    getTransactionReceipt: async () => ({
      status: "success",
      logs: [{
        address: token,
        topics: encodeEventTopics({
          abi: transferAbi,
          eventName: "Transfer",
          args: { from: source, to: recipient },
        }) as [Hex, ...Hex[]],
        data: encodeAbiParameters([{ type: "uint256" }], [100n]),
      }],
    }),
  };
}

describe("live buyer receipt verification", () => {
  it("completes only when the committed transfer event is present", async () => {
    const verifier = new LiveBuyerExecutionVerifier(
      xLayerMainnetConfig,
      "https://unused.invalid",
      () => new Date("2026-07-13T10:01:00.000Z"),
      clientFor(destination),
    );
    const observation = await verifier.verify(
      { signingPackage } as AgentServiceJob,
      report,
    );

    expect(observation.phase).toBe("COMPLETED");
    expect(observation.transactionHashes).toEqual([txHash]);
  });

  it("rejects a successful receipt that transferred to another address", async () => {
    const verifier = new LiveBuyerExecutionVerifier(
      xLayerMainnetConfig,
      "https://unused.invalid",
      () => new Date("2026-07-13T10:01:00.000Z"),
      clientFor(wrongDestination),
    );

    await expect(verifier.verify(
      { signingPackage } as AgentServiceJob,
      report,
    )).rejects.toThrow("do not prove the committed asset transfer");
  });
});
