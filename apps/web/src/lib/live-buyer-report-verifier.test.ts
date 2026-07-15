import { describe, expect, it } from "vitest";
import {
  encodeAbiParameters,
  encodeEventTopics,
  encodeFunctionData,
  parseSignature,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import {
  BuyerReceiptPendingError,
  BuyerReceiptRejectedError,
  BuyerReceiptRevertedError,
  SIGNING_PACKAGE_EIP712_TYPES,
  buyerExecutionReportSchema,
  signingPackageSchema,
  type AgentServiceJob,
} from "@safeexit/agent-service";
import {
  getConfiguredPermitSettlementAddress,
  PERMIT_KIND_ERC2612,
  PERMIT_SETTLEMENT_NAME,
  PERMIT_SETTLEMENT_VERSION,
  permitSettlementAbi,
} from "@safeexit/adapters";
import { xLayerMainnetConfig } from "@safeexit/chain";

import {
  LiveBuyerExecutionVerifier,
  type BuyerReceiptClient,
} from "./live-buyer-report-verifier";

const sourceAccount = privateKeyToAccount(`0x${"22".repeat(32)}`);
const source = sourceAccount.address;
const destination = "0x2222222222222222222222222222222222222222" as const;
const wrongDestination = "0x3333333333333333333333333333333333333333" as const;
const token = "0x4444444444444444444444444444444444444444" as const;
const settlementContract = getConfiguredPermitSettlementAddress(196)!;
const txHash = `0x${"55".repeat(32)}` as Hex;
const blockHash = `0x${"44".repeat(32)}` as Hex;
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
  route: "ERC2612_PERMIT_SETTLEMENT",
  chainId: 196,
  sourceAddress: source,
  destinationAddress: destination,
  observedAtBlock: "100",
  expiresAt,
  tokenAddress: token,
  settlementContract,
  amount: "100",
  sourceSigningRequests: [
    {
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
          spender: settlementContract,
          value: "100",
          nonce: "0",
          deadline,
        },
      },
    },
    {
      id: "source-rescue-authorization",
      signer: source,
      method: "EIP712",
      rpcMethod: "eth_signTypedData_v4",
      typedData: {
        primaryType: "ERC20Rescue",
        types: {
          EIP712Domain: [...SIGNING_PACKAGE_EIP712_TYPES.EIP712Domain],
          ERC20Rescue: [...SIGNING_PACKAGE_EIP712_TYPES.ERC20Rescue],
        },
        domain: {
          name: PERMIT_SETTLEMENT_NAME,
          version: PERMIT_SETTLEMENT_VERSION,
          chainId: 196,
          verifyingContract: settlementContract,
        },
        message: {
          token,
          owner: source,
          destination,
          amount: "100",
          permitNonce: "0",
          deadline,
          rescueNonce: `0x${"9".repeat(64)}`,
          permitKind: PERMIT_KIND_ERC2612,
        },
      },
    },
  ],
  destinationSettlement: {
    executor: destination,
    payer: "DESTINATION",
    assembly: "BUYER_LOCAL_RUNTIME",
    atomicRequired: false,
    operations: ["SETTLE_ERC2612"],
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

function signatureParts(signature: Hex) {
  const parsed = parseSignature(signature);
  return {
    v: Number(parsed.v ?? BigInt((parsed.yParity ?? 0) + 27)),
    r: parsed.r,
    s: parsed.s,
  };
}

async function transactionInput(): Promise<Hex> {
  if (signingPackage.route !== "ERC2612_PERMIT_SETTLEMENT") {
    throw new Error("Expected ERC-2612 signing package fixture");
  }
  const requests = signingPackage.sourceSigningRequests;
  const signatures = await Promise.all(requests.map((request) => {
    const types = { ...request.typedData.types } as Record<
      string,
      readonly { name: string; type: string }[]
    >;
    delete types.EIP712Domain;
    return sourceAccount.signTypedData({
      domain: {
        ...request.typedData.domain,
        verifyingContract: request.typedData.domain.verifyingContract as Address,
      },
      types,
      primaryType: request.typedData.primaryType,
      message: Object.fromEntries(
        Object.entries(request.typedData.message).map(([key, value]) => [
          key,
          typeof value === "string" && /^\d+$/.test(value) ? BigInt(value) : value,
        ]),
      ),
    });
  }));
  const permit = signatures[0];
  const rescue = signatures[1];
  if (!permit || !rescue) throw new Error("Missing test signatures");
  const committed = requests[1].typedData.message;
  return encodeFunctionData({
    abi: permitSettlementAbi,
    functionName: "settleERC2612",
    args: [
      token,
      source,
      destination,
      100n,
      0n,
      BigInt(committed.deadline),
      committed.rescueNonce as Hex,
      signatureParts(permit),
      signatureParts(rescue),
    ],
  });
}

async function clientFor(
  recipient: `0x${string}`,
  destinationBalance = 100n,
  latestBlockNumber = 164n,
  canonicalBlockHash: Hex = blockHash,
): Promise<BuyerReceiptClient> {
  const input = await transactionInput();
  return {
    getTransactionReceipt: async () => ({
      status: "success",
      blockNumber: 101n,
      blockHash,
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
    getTransaction: async () => ({
      from: destination,
      to: settlementContract as Address,
      value: 0n,
      input,
    }),
    getBlockNumber: async () => latestBlockNumber,
    getBlock: async () => ({ hash: canonicalBlockHash }),
    getErc20Balance: async () => destinationBalance,
    getErc721Owner: async () => destination,
  };
}

describe("live buyer receipt verification", () => {
  it("completes only when the committed transfer event is present", async () => {
    const verifier = new LiveBuyerExecutionVerifier(
      xLayerMainnetConfig,
      "https://unused.invalid",
      () => new Date("2026-07-13T10:01:00.000Z"),
      await clientFor(destination),
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
      await clientFor(wrongDestination),
    );

    await expect(verifier.verify(
      { signingPackage } as AgentServiceJob,
      report,
    )).rejects.toBeInstanceOf(BuyerReceiptRejectedError);
  });

  it("distinguishes a pending receipt from a rejected transfer", async () => {
    const receiptMissing = new Error("receipt not found");
    receiptMissing.name = "TransactionReceiptNotFoundError";
    const client = await clientFor(destination);
    const verifier = new LiveBuyerExecutionVerifier(
      xLayerMainnetConfig,
      "https://unused.invalid",
      () => new Date("2026-07-13T10:01:00.000Z"),
      { ...client, getTransactionReceipt: async () => { throw receiptMissing; } },
    );

    await expect(verifier.verify(
      { signingPackage } as AgentServiceJob,
      report,
    )).rejects.toBeInstanceOf(BuyerReceiptPendingError);
  });

  it("distinguishes a reverted settlement receipt", async () => {
    const client = await clientFor(destination);
    const verifier = new LiveBuyerExecutionVerifier(
      xLayerMainnetConfig,
      "https://unused.invalid",
      () => new Date("2026-07-13T10:01:00.000Z"),
      {
        ...client,
        getTransactionReceipt: async () => ({
          status: "reverted",
          blockNumber: 101n,
          blockHash,
          logs: [],
        }),
      },
    );

    await expect(verifier.verify(
      { signingPackage } as AgentServiceJob,
      report,
    )).rejects.toBeInstanceOf(BuyerReceiptRevertedError);
  });

  it("rejects a receipt when final token state does not contain the rescued amount", async () => {
    const verifier = new LiveBuyerExecutionVerifier(
      xLayerMainnetConfig,
      "https://unused.invalid",
      () => new Date("2026-07-13T10:01:00.000Z"),
      await clientFor(destination, 99n),
    );

    await expect(verifier.verify(
      { signingPackage } as AgentServiceJob,
      report,
    )).rejects.toBeInstanceOf(BuyerReceiptRejectedError);
  });

  it("keeps a successful receipt pending until the chain confirmation policy is met", async () => {
    const verifier = new LiveBuyerExecutionVerifier(
      xLayerMainnetConfig,
      "https://unused.invalid",
      () => new Date("2026-07-13T10:01:00.000Z"),
      await clientFor(destination, 100n, 163n),
    );

    await expect(verifier.verify(
      { signingPackage } as AgentServiceJob,
      report,
    )).rejects.toBeInstanceOf(BuyerReceiptPendingError);
  });

  it("keeps a receipt pending when its block is no longer canonical", async () => {
    const verifier = new LiveBuyerExecutionVerifier(
      xLayerMainnetConfig,
      "https://unused.invalid",
      () => new Date("2026-07-13T10:01:00.000Z"),
      await clientFor(destination, 100n, 164n, `0x${"33".repeat(32)}`),
    );

    await expect(verifier.verify(
      { signingPackage } as AgentServiceJob,
      report,
    )).rejects.toBeInstanceOf(BuyerReceiptPendingError);
  });

  it("rechecks canonicality after final state reads", async () => {
    const client = await clientFor(destination);
    let blockChecks = 0;
    const verifier = new LiveBuyerExecutionVerifier(
      xLayerMainnetConfig,
      "https://unused.invalid",
      () => new Date("2026-07-13T10:01:00.000Z"),
      {
        ...client,
        getBlock: async () => ({
          hash: ++blockChecks === 1 ? blockHash : `0x${"22".repeat(32)}`,
        }),
      },
    );

    await expect(verifier.verify(
      { signingPackage } as AgentServiceJob,
      report,
    )).rejects.toBeInstanceOf(BuyerReceiptPendingError);
  });
});
