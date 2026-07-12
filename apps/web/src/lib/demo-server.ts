import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { createPublicClient, http, parseAbi, type Address } from "viem";

import {
  demoReportSchema,
  demoRuntimeStateSchema,
  deriveDemoActualState,
  type DemoRuntimeState,
} from "./demo-runtime";
import { parseDeploymentEnvironment } from "./deployment-env";
import { createHostedDemoState } from "./hosted-demo-fixture";

type DemoStateFile = {
  chainId: number;
  rpcUrl: string;
  compromised: Address;
  destination: Address;
  attackerSink: Address;
  token: Address;
  nft: Address;
  airdrop: Address;
  attackerSimulation: Address;
  nftTokenId: number;
};

const erc20Abi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
]);
const nftAbi = parseAbi(["function ownerOf(uint256) view returns (address)"]);
const airdropAbi = parseAbi(["function claimable(address) view returns (uint256)"]);
const fixedAddresses = {
  compromised: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
  destination: "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65",
  attackerSink: "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
  token: "0x5FbDB2315678afecb367f032d93F642f64180aa3",
  nft: "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512",
  airdrop: "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0",
  attackerSimulation: "0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9",
} as const;

function readJsonFile(filePath: string): unknown {
  return JSON.parse(readFileSync(filePath, "utf8").replace(/^\uFEFF/, "")) as unknown;
}

export function getWorkspaceRoot(): string {
  const candidates = [process.cwd(), path.resolve(process.cwd(), "..", "..")];
  const root = candidates.find((candidate) =>
    existsSync(path.join(candidate, "scripts", "demo", "run-rescue.ps1")),
  );
  if (!root) {
    throw new Error("SAFEEXIT workspace root could not be resolved");
  }
  return root;
}

function parseAddress(value: unknown, field: string): Address {
  if (typeof value !== "string" || !/^0x[a-fA-F0-9]{40}$/.test(value)) {
    throw new Error(`Invalid demo fixture ${field}`);
  }
  return value as Address;
}

function readStateFile(root: string): DemoStateFile {
  const raw = readJsonFile(
    path.join(root, ".demo", "demo-state.json"),
  ) as Record<string, unknown>;
  if (raw.chainId !== 31_337 || raw.rpcUrl !== "http://127.0.0.1:8545") {
    throw new Error("Demo fixture must use the fixed local Anvil chain");
  }
  const parsed = {
    chainId: 31_337,
    rpcUrl: raw.rpcUrl,
    compromised: parseAddress(raw.compromised, "source"),
    destination: parseAddress(raw.destination, "destination"),
    attackerSink: parseAddress(raw.attackerSink, "attacker sink"),
    token: parseAddress(raw.token, "token"),
    nft: parseAddress(raw.nft, "NFT"),
    airdrop: parseAddress(raw.airdrop, "airdrop"),
    attackerSimulation: parseAddress(raw.attackerSimulation, "attacker simulation"),
    nftTokenId: raw.nftTokenId === 1 ? 1 : 0,
  };
  for (const [key, expected] of Object.entries(fixedAddresses)) {
    if (parsed[key as keyof typeof fixedAddresses].toLowerCase() !== expected.toLowerCase()) {
      throw new Error(`Demo fixture ${key} does not match the fixed local scenario`);
    }
  }
  if (parsed.nftTokenId !== 1) {
    throw new Error("Demo fixture NFT token ID does not match the fixed local scenario");
  }
  return parsed;
}

export async function readDemoRuntimeState(): Promise<DemoRuntimeState> {
  const deployment = parseDeploymentEnvironment();
  if (deployment.demoMode === "HOSTED_REPLAY") {
    return createHostedDemoState();
  }
  if (deployment.demoMode === "DISABLED") {
    return demoRuntimeStateSchema.parse({
      availability: "NOT_SEEDED",
      executionMode: "DISABLED",
      message: "The SAFEEXIT demo is disabled for this deployment.",
    });
  }

  let root: string;
  try {
    root = getWorkspaceRoot();
  } catch {
    return demoRuntimeStateSchema.parse({
      availability: "INVALID_FIXTURE",
      executionMode: "LOCAL_FIXED_SCRIPT",
      message: "The SAFEEXIT workspace could not be resolved on this server.",
    });
  }

  const statePath = path.join(root, ".demo", "demo-state.json");
  const reportPath = path.join(root, ".demo", "demo-report.json");
  if (!existsSync(statePath) || !existsSync(reportPath)) {
    return demoRuntimeStateSchema.parse({
      availability: "NOT_SEEDED",
      executionMode: "LOCAL_FIXED_SCRIPT",
      message: "Run npm run demo:prepare to create the fixed local fixture.",
    });
  }

  try {
    const state = readStateFile(root);
    const report = demoReportSchema.parse(readJsonFile(reportPath));
    const client = createPublicClient({
      transport: http(state.rpcUrl, { timeout: 2_500 }),
    });
    const [chainId, blockNumber, sourceNativeBalance, sourceTokenBalance, destinationTokenBalance, claimableReward, activeAllowance, nftOwner] =
      await Promise.all([
        client.getChainId(),
        client.getBlockNumber(),
        client.getBalance({ address: state.compromised }),
        client.readContract({ address: state.token, abi: erc20Abi, functionName: "balanceOf", args: [state.compromised] }),
        client.readContract({ address: state.token, abi: erc20Abi, functionName: "balanceOf", args: [state.destination] }),
        client.readContract({ address: state.airdrop, abi: airdropAbi, functionName: "claimable", args: [state.compromised] }),
        client.readContract({ address: state.token, abi: erc20Abi, functionName: "allowance", args: [state.compromised, state.attackerSimulation] }),
        client.readContract({ address: state.nft, abi: nftAbi, functionName: "ownerOf", args: [1n] }),
      ]);
    if (chainId !== 31_337) {
      throw new Error("Unexpected local chain ID");
    }
    const chain = {
      chainId: 31_337 as const,
      blockNumber: blockNumber.toString(),
      sourceNativeBalance: sourceNativeBalance.toString(),
      sourceTokenBalance: sourceTokenBalance.toString(),
      destinationTokenBalance: destinationTokenBalance.toString(),
      claimableReward: claimableReward.toString(),
      activeAllowance: activeAllowance.toString(),
      nftOwner,
    };
    const actualState = deriveDemoActualState(
      chain,
      report,
      state.compromised,
      state.destination,
    );
    return demoRuntimeStateSchema.parse({
      availability: "READY",
      executionMode: "LOCAL_FIXED_SCRIPT",
      message:
        actualState === "RESCUED"
          ? "The fixed local rescue is complete and verified on Anvil."
          : actualState === "AT_RISK"
            ? "The fixed local incident is seeded and ready for review."
            : "The local fixture is changing or only partially matches the expected state.",
      actualState,
      report,
      chain,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown fixture error";
    const offline = /fetch failed|ECONNREFUSED|HTTP request failed/i.test(message);
    return demoRuntimeStateSchema.parse({
      availability: offline ? "CHAIN_OFFLINE" : "INVALID_FIXTURE",
      executionMode: "LOCAL_FIXED_SCRIPT",
      message: offline
        ? "Local Anvil is offline. Run npm run demo:prepare."
        : "The local fixture failed validation. Reseed it with npm run demo:prepare.",
    });
  }
}
