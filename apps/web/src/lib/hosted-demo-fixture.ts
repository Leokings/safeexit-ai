import {
  demoRuntimeStateSchema,
  type DemoRuntimeState,
} from "./demo-runtime";

const source = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const observedAt = "2026-07-12T05:24:30.697Z";

export function createHostedDemoState(): DemoRuntimeState {
  return demoRuntimeStateSchema.parse({
    availability: "READY",
    executionMode: "READ_ONLY_REPLAY",
    message:
      "Verified local fixture replay. Execution is intentionally disabled on hosted deployments.",
    actualState: "AT_RISK",
    report: {
      schemaVersion: "safeexit-demo-v1",
      incidentId: "demo-31337",
      phase: "READY",
      updatedAt: observedAt,
      executionStartedAt: null,
      executionCompletedAt: null,
      error: null,
      simulation: {
        status: "PASSED",
        verifiedAt: observedAt,
        snapshotReverted: true,
        actions: [
          {
            id: "action:claim",
            status: "PASSED",
            gasUsed: "34873",
            transactionHash:
              "0x8e67b77902b0a20f46e954bc946923da4b577eb8f3cf791272c30f72bb4e299a",
          },
          {
            id: "action:token",
            status: "PASSED",
            gasUsed: "46803",
            transactionHash:
              "0xd7fd2f1f7620d0f4cc08eff80c97c834815b248bf6265638f92575c5a64de045",
          },
          {
            id: "action:nft",
            status: "PASSED",
            gasUsed: "57872",
            transactionHash:
              "0x7b824696e6e07720650cbb4e5bbeb62317aa9c7d1f39b7a2dbf9cea8174fd692",
          },
          {
            id: "action:revoke",
            status: "PASSED",
            gasUsed: "24394",
            transactionHash:
              "0xd4d37a2a92b3be529f46acc98fd0432ca399d27cd95446813e9b640baaa00281",
          },
        ],
      },
      actions: [
        {
          id: "action:claim",
          title: "Claim configured reward",
          status: "READY",
          transactionHash: null,
          gasUsed: null,
        },
        {
          id: "action:token",
          title: "Transfer RescueToken",
          status: "READY",
          transactionHash: null,
          gasUsed: null,
        },
        {
          id: "action:nft",
          title: "Transfer Demo NFT #1",
          status: "READY",
          transactionHash: null,
          gasUsed: null,
        },
        {
          id: "action:revoke",
          title: "Revoke demo allowance",
          status: "READY",
          transactionHash: null,
          gasUsed: null,
        },
      ],
      events: [
        {
          sequence: 0,
          label: "Verified fixture replay loaded",
          status: "COMPLETED",
          at: observedAt,
        },
      ],
    },
    chain: {
      chainId: 31_337,
      blockNumber: "9",
      sourceNativeBalance: "9999999983686638722858",
      sourceTokenBalance: "100000000000000000000",
      destinationTokenBalance: "0",
      claimableReward: "50000000000000000000",
      activeAllowance: "25000000000000000000",
      nftOwner: source,
    },
  });
}
