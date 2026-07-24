import { randomBytes, randomUUID } from "node:crypto";

import {
  eip7702LocalSigningPackageSchema,
  type AgentServiceJob,
  type Eip7702LocalSigningPackage,
} from "@safeexit/agent-service";
import {
  EIP7702_RESCUE_CHAIN_IDS,
  eip7702RescueDelegateFactoryAbi,
  hashEip7702RescuePlan,
  toEip7702RescueActions,
} from "@safeexit/adapters";
import {
  createDedicatedPublicClient,
  type ChainAdapterConfig,
} from "@safeexit/chain";
import { verifyPlanIntegrity } from "@safeexit/planner";
import {
  evmAddressSchema,
  type RescueAction,
  type SimulationResult,
} from "@safeexit/shared";
import {
  getAddress,
  keccak256,
  type Address,
  type Hex,
} from "viem";

export type ReadyEip7702AgentJob = AgentServiceJob & {
  incident: NonNullable<AgentServiceJob["incident"]>;
  plan: NonNullable<AgentServiceJob["plan"]>;
  simulation: NonNullable<AgentServiceJob["simulation"]>;
};

export type Eip7702FactoryConfiguration = {
  address: Address;
  runtimeHash: Hex;
};

type SelectedAction = {
  action: RescueAction;
  simulation: SimulationResult;
};

export const EIP7702_SIMULATION_PROVIDER_ID =
  "safeexit-xlayer-eip7702-state-simulation-v1";

function eligibleActions(
  job: ReadyEip7702AgentJob,
  now: Date,
): readonly SelectedAction[] {
  if (job.simulation.providerId !== EIP7702_SIMULATION_PROVIDER_ID) {
    return [];
  }
  const executable = new Set(job.simulation.executableActionIds);
  const simulations = new Map(
    job.simulation.results.map((result) => [result.actionId, result]),
  );
  return job.plan.actions.flatMap((action) => {
    const simulation = simulations.get(action.id);
    const adapterSupported =
      action.actionType === "TRANSFER_NATIVE" ||
      action.actionType === "TRANSFER_ERC20" ||
      action.actionType === "TRANSFER_ERC721" ||
      action.actionType === "TRANSFER_ERC1155" ||
      action.actionType === "REVOKE_ERC20_APPROVAL" ||
      action.actionType === "REVOKE_NFT_OPERATOR";
    return adapterSupported &&
      executable.has(action.id) &&
      action.supportStatus === "SUPPORTED" &&
      action.simulationStatus === "PASSED" &&
      simulation?.status === "SUCCEEDED" &&
      simulation.providerId === EIP7702_SIMULATION_PROVIDER_ID &&
      Date.parse(simulation.expiresAt) > now.getTime()
      ? [{ action, simulation }]
      : [];
  });
}

function packageExpiry(
  selected: readonly SelectedAction[],
  now: Date,
): Date {
  const earliestSimulationExpiry = Math.min(
    ...selected.map(({ simulation }) => Date.parse(simulation.expiresAt)),
  );
  const expiry = Math.min(
    now.getTime() + 10 * 60 * 1_000,
    earliestSimulationExpiry - 10_000,
  );
  if (
    !Number.isFinite(earliestSimulationExpiry) ||
    expiry <= now.getTime() + 30_000
  ) {
    throw new Error("EIP-7702 simulations expire too soon for local authorization");
  }
  return new Date(Math.floor(expiry / 1_000) * 1_000);
}

export function assembleEip7702LocalSigningPackage(input: {
  job: ReadyEip7702AgentJob;
  factory: Eip7702FactoryConfiguration;
  delegateAddress: Address;
  sourceNonce: number;
  rescueNonce: Hex;
  now: Date;
}): Eip7702LocalSigningPackage {
  const { job, now } = input;
  if (!verifyPlanIntegrity(job.plan)) {
    throw new Error("Rescue plan integrity verification failed");
  }
  if (!(EIP7702_RESCUE_CHAIN_IDS as readonly number[]).includes(job.plan.chainId)) {
    throw new Error(`EIP-7702 package generation is disabled on chain ${job.plan.chainId}`);
  }
  const selected = eligibleActions(job, now);
  if (selected.length === 0) {
    throw new Error("No supported, freshly simulated EIP-7702 rescue action is available");
  }
  const actions = toEip7702RescueActions(
    selected.map(({ action }) => action),
    job.plan.sourceAddress,
    job.plan.destinationAddress,
  );
  const expiresAt = packageExpiry(selected, now);

  return eip7702LocalSigningPackageSchema.parse({
    schemaVersion: "safeexit-eip7702-signing-package-v1",
    packageId: `eip7702-package:${randomUUID()}`,
    jobId: job.id,
    incidentId: job.incident.id,
    planId: job.plan.id,
    planHash: job.plan.integrityHash,
    delegatePlanHash: hashEip7702RescuePlan(actions),
    route: "EIP7702_DELEGATED_RESCUE",
    chainId: job.plan.chainId,
    sourceAddress: job.plan.sourceAddress,
    destinationAddress: job.plan.destinationAddress,
    observedAtBlock: job.plan.observedAtBlock,
    expiresAt: expiresAt.toISOString(),
    deadline: Math.floor(expiresAt.getTime() / 1_000),
    sourceNonce: input.sourceNonce,
    rescueNonce: input.rescueNonce,
    factoryAddress: evmAddressSchema.parse(input.factory.address),
    factoryRuntimeHash: input.factory.runtimeHash,
    delegateAddress: evmAddressSchema.parse(input.delegateAddress),
    actionIds: selected.map(({ action }) => action.id),
    actions: actions.map((action) => ({
      ...action,
      tokenId: action.tokenId.toString(),
      amount: action.amount.toString(),
    })),
    executionIndexes: actions.map((_, index) => index),
    simulation: {
      resultIds: selected.map(({ simulation }) => simulation.id),
      providerId: job.simulation.providerId,
      status: "SUCCEEDED",
      expiresAt: new Date(Math.min(
        ...selected.map(({ simulation }) => Date.parse(simulation.expiresAt)),
      )).toISOString(),
    },
    policy: {
      sourceSignsLocally: true,
      destinationPaysAllGas: true,
      privateCredentialsAccepted: false,
      authorizationsReturnedToSafeExit: false,
      arbitraryCallsAllowed: false,
      postAuthorizationSimulationRequired: true,
      delegationClearRequired: true,
    },
  });
}

export class LiveEip7702SigningPackageBuilder {
  private readonly client: ReturnType<typeof createDedicatedPublicClient>;

  constructor(
    private readonly chain: ChainAdapterConfig,
    rpcUrl: string,
    private readonly factory: Eip7702FactoryConfiguration,
    private readonly clock: () => Date = () => new Date(),
  ) {
    if (!(EIP7702_RESCUE_CHAIN_IDS as readonly number[]).includes(chain.chain.id)) {
      throw new Error(`EIP-7702 package generation is disabled on chain ${chain.chain.id}`);
    }
    this.client = createDedicatedPublicClient(chain, rpcUrl);
  }

  async build(jobValue: AgentServiceJob): Promise<Eip7702LocalSigningPackage> {
    if (!jobValue.incident || !jobValue.plan || !jobValue.simulation) {
      throw new Error("Incident, plan, and simulation are required");
    }
    const job = jobValue as ReadyEip7702AgentJob;
    if (job.plan.chainId !== this.chain.chain.id) {
      throw new Error("EIP-7702 signing-package chain is not configured");
    }
    const sourceAddress = getAddress(job.plan.sourceAddress);
    const factoryCode = await this.client.getCode({
      address: this.factory.address,
    });
    if (
      !factoryCode ||
      factoryCode === "0x" ||
      keccak256(factoryCode).toLowerCase() !== this.factory.runtimeHash.toLowerCase()
    ) {
      throw new Error("The configured EIP-7702 factory runtime is not verified");
    }
    const sourceCode = await this.client.getCode({ address: sourceAddress });
    if (sourceCode && sourceCode !== "0x") {
      throw new Error("The source already has delegated code");
    }
    const sourceNonce = await this.client.getTransactionCount({
      address: sourceAddress,
      blockTag: "pending",
    });
    const rescueNonce = `0x${randomBytes(32).toString("hex")}` as Hex;
    const now = this.clock();
    const selected = eligibleActions(job, now);
    if (selected.length === 0) {
      throw new Error("No supported, freshly simulated EIP-7702 rescue action is available");
    }
    const actions = toEip7702RescueActions(
      selected.map(({ action }) => action),
      job.plan.sourceAddress,
      job.plan.destinationAddress,
    );
    const deadline = Math.floor(packageExpiry(selected, now).getTime() / 1_000);
    const delegatePlanHash = hashEip7702RescuePlan(actions);
    const delegateAddress = await this.client.readContract({
      address: this.factory.address,
      abi: eip7702RescueDelegateFactoryAbi,
      functionName: "predictDelegate",
      args: [
        sourceAddress,
        getAddress(job.plan.destinationAddress),
        BigInt(deadline),
        delegatePlanHash,
        rescueNonce,
      ],
    });
    return assembleEip7702LocalSigningPackage({
      job,
      factory: this.factory,
      delegateAddress,
      sourceNonce,
      rescueNonce,
      now,
    });
  }
}
