import { randomBytes, randomUUID } from "node:crypto";

import type {
  AgentServiceJob,
  SigningDomain,
  SigningPackage,
  SigningPackageBuilderPort,
} from "@safeexit/agent-service";
import { SIGNING_PACKAGE_EIP712_TYPES } from "@safeexit/agent-service";
import {
  createDedicatedPublicClient,
  type ChainAdapterConfig,
} from "@safeexit/chain";
import {
  evmAddressSchema,
  type RescueAction,
  type SimulationResult,
} from "@safeexit/shared";
import {
  encodeFunctionData,
  hashDomain,
  keccak256,
  stringToHex,
  type Address,
  type Hex,
} from "viem";

const metadataAbi = [
  {
    type: "function",
    name: "name",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
  },
] as const;

const domainAbi = [
  {
    type: "function",
    name: "eip712Domain",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "fields", type: "bytes1" },
      { name: "name", type: "string" },
      { name: "version", type: "string" },
      { name: "chainId", type: "uint256" },
      { name: "verifyingContract", type: "address" },
      { name: "salt", type: "bytes32" },
      { name: "extensions", type: "uint256[]" },
    ],
  },
  {
    type: "function",
    name: "DOMAIN_SEPARATOR",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "bytes32" }],
  },
] as const;

const eip3009Abi = [
  {
    type: "function",
    name: "RECEIVE_WITH_AUTHORIZATION_TYPEHASH",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "bytes32" }],
  },
  {
    type: "function",
    name: "authorizationState",
    stateMutability: "view",
    inputs: [
      { name: "authorizer", type: "address" },
      { name: "nonce", type: "bytes32" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

const erc20BalanceAbi = [{
  type: "function",
  name: "balanceOf",
  stateMutability: "view",
  inputs: [{ name: "account", type: "address" }],
  outputs: [{ name: "", type: "uint256" }],
}] as const;

const erc2612Abi = [
  {
    type: "function",
    name: "nonces",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "permit",
    stateMutability: "nonpayable",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
      { name: "value", type: "uint256" },
      { name: "deadline", type: "uint256" },
      { name: "v", type: "uint8" },
      { name: "r", type: "bytes32" },
      { name: "s", type: "bytes32" },
    ],
    outputs: [],
  },
] as const;

const daiPermitAbi = [
  {
    type: "function",
    name: "nonces",
    stateMutability: "view",
    inputs: [{ name: "holder", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "PERMIT_TYPEHASH",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "bytes32" }],
  },
  {
    type: "function",
    name: "permit",
    stateMutability: "nonpayable",
    inputs: [
      { name: "holder", type: "address" },
      { name: "spender", type: "address" },
      { name: "nonce", type: "uint256" },
      { name: "expiry", type: "uint256" },
      { name: "allowed", type: "bool" },
      { name: "v", type: "uint8" },
      { name: "r", type: "bytes32" },
      { name: "s", type: "bytes32" },
    ],
    outputs: [],
  },
] as const;

const domainTypes = {
  EIP712Domain: [
    { name: "name", type: "string" },
    { name: "version", type: "string" },
    { name: "chainId", type: "uint256" },
    { name: "verifyingContract", type: "address" },
  ],
} as const;

const receiveTypehash =
  "0xd099cc98ef71107a616c4f0f941f04c322d8e254fe26b3c6668db87aae413de8";
const daiTypehash = keccak256(stringToHex(
  "Permit(address holder,address spender,uint256 nonce,uint256 expiry,bool allowed)",
));
const zeroBytes32 = `0x${"00".repeat(32)}` as const;

type PermitCapability =
  | { route: "ERC3009_RECEIVE_WITH_AUTHORIZATION"; domain: SigningDomain }
  | { route: "ERC2612_PERMIT_ATOMIC_BATCH"; domain: SigningDomain; nonce: bigint }
  | { route: "DAI_PERMIT_ATOMIC_BATCH"; domain: SigningDomain; nonce: bigint };

type ReadyAgentJob = AgentServiceJob & {
  incident: NonNullable<AgentServiceJob["incident"]>;
  plan: NonNullable<AgentServiceJob["plan"]>;
  simulation: NonNullable<AgentServiceJob["simulation"]>;
};

function safeDomainText(value: string, maximum: number): string {
  return value.replace(/[\u0000-\u001F\u007F]/g, "").trim().slice(0, maximum);
}

function packagePolicy() {
  return {
    sourceSignsLocally: true as const,
    destinationPaysSettlement: true as const,
    privateCredentialsAccepted: false as const,
    signaturesReturnedToSafeExit: false as const,
    arbitraryCallsAllowed: false as const,
    postSignatureSimulationRequired: true as const,
  };
}

export class LivePermitSigningPackageBuilder implements SigningPackageBuilderPort {
  private readonly client: ReturnType<typeof createDedicatedPublicClient>;

  constructor(
    private readonly chain: ChainAdapterConfig,
    rpcUrl: string,
    private readonly clock: () => Date = () => new Date(),
  ) {
    this.client = createDedicatedPublicClient(chain, rpcUrl);
  }

  async build(job: AgentServiceJob): Promise<SigningPackage> {
    if (!job.incident || !job.plan || !job.simulation) {
      throw new Error("Incident, plan, and simulation are required");
    }
    if (job.plan.chainId !== this.chain.chain.id) {
      throw new Error("Signing-package chain is not configured");
    }
    const now = this.clock();
    const observedAtBlock = BigInt(job.plan.observedAtBlock);
    const currentBlock = await this.client.getBlockNumber();
    if (currentBlock < observedAtBlock) {
      throw new Error("RPC head is behind the committed rescue plan block");
    }
    for (const action of job.plan.actions) {
      if (
        action.actionType !== "TRANSFER_ERC20" ||
        !job.simulation.executableActionIds.includes(action.id)
      ) {
        continue;
      }
      const simulation = job.simulation.results.find(
        (candidate) => candidate.actionId === action.id && candidate.status === "SUCCEEDED",
      );
      if (!simulation) {
        continue;
      }
      const expiresAt = this.packageExpiry(now, simulation.expiresAt);
      const tokenAddress = action.parameters.tokenAddress as Address;
      const currentBalance = await this.client.readContract({
        address: tokenAddress,
        abi: erc20BalanceAbi,
        functionName: "balanceOf",
        args: [job.plan.sourceAddress as Address],
        blockNumber: currentBlock,
      });
      if (currentBalance < BigInt(action.parameters.amount)) {
        throw new Error("Source token balance changed after the committed simulation");
      }
      const capability = await this.detectCapability(
        tokenAddress,
        job.plan.sourceAddress as Address,
        job.plan.destinationAddress as Address,
        currentBlock,
      );
      if (!capability) {
        continue;
      }
      return this.buildTokenPackage(
        job as ReadyAgentJob,
        action,
        simulation,
        capability,
        expiresAt,
      );
    }
    throw new Error("No simulated ERC-20 action exposes a verified destination-paid permit route");
  }

  private async readDomain(
    tokenAddress: Address,
    blockNumber: bigint,
  ): Promise<SigningDomain | undefined> {
    try {
      const [fields, separator] = await Promise.all([
        this.client.readContract({
          address: tokenAddress,
          abi: domainAbi,
          functionName: "eip712Domain",
          blockNumber,
        }),
        this.client.readContract({
          address: tokenAddress,
          abi: domainAbi,
          functionName: "DOMAIN_SEPARATOR",
          blockNumber,
        }),
      ]);
      const [fieldMask, rawName, rawVersion, chainId, verifyingContract, , extensions] = fields;
      const name = safeDomainText(rawName, 128);
      const version = safeDomainText(rawVersion, 32);
      if (
        (Number(BigInt(fieldMask)) & 0x0f) !== 0x0f ||
        !name ||
        !version ||
        chainId !== BigInt(this.chain.chain.id) ||
        verifyingContract.toLowerCase() !== tokenAddress.toLowerCase() ||
        extensions.length > 0
      ) {
        return undefined;
      }
      const computed = hashDomain({
        domain: { name, version, chainId, verifyingContract },
        types: domainTypes,
      });
      return computed.toLowerCase() === separator.toLowerCase()
        ? {
            name,
            version,
            chainId: this.chain.chain.id,
            verifyingContract: evmAddressSchema.parse(verifyingContract),
          }
        : undefined;
    } catch {
      return undefined;
    }
  }

  private async detectCapability(
    tokenAddress: Address,
    source: Address,
    destination: Address,
    blockNumber: bigint,
  ): Promise<PermitCapability | undefined> {
    const domain = await this.readDomain(tokenAddress, blockNumber);
    if (domain) {
      try {
        const [typehash] = await Promise.all([
          this.client.readContract({
            address: tokenAddress,
            abi: eip3009Abi,
            functionName: "RECEIVE_WITH_AUTHORIZATION_TYPEHASH",
            blockNumber,
          }),
          this.client.readContract({
            address: tokenAddress,
            abi: eip3009Abi,
            functionName: "authorizationState",
            args: [source, zeroBytes32],
            blockNumber,
          }),
        ]);
        if (typehash.toLowerCase() === receiveTypehash) {
          return { route: "ERC3009_RECEIVE_WITH_AUTHORIZATION", domain };
        }
      } catch {
        // Continue to permit-based routes.
      }
      try {
        const nonce = await this.client.readContract({
          address: tokenAddress,
          abi: erc2612Abi,
          functionName: "nonces",
          args: [source],
          blockNumber,
        });
        const probe = encodeFunctionData({
          abi: erc2612Abi,
          functionName: "permit",
          args: [source, destination, 1n, 9_999_999_999n, 27, zeroBytes32, zeroBytes32],
        });
        try {
          await this.client.call({
            account: destination,
            to: tokenAddress,
            data: probe,
            blockNumber,
          });
        } catch {
          return { route: "ERC2612_PERMIT_ATOMIC_BATCH", domain, nonce };
        }
      } catch {
        // Continue to strict DAI-style detection.
      }
    }
    return this.detectDaiCapability(tokenAddress, source, destination, blockNumber);
  }

  private async detectDaiCapability(
    tokenAddress: Address,
    source: Address,
    destination: Address,
    blockNumber: bigint,
  ): Promise<PermitCapability | undefined> {
    try {
      const [rawName, separator, typehash, nonce] = await Promise.all([
        this.client.readContract({
          address: tokenAddress,
          abi: metadataAbi,
          functionName: "name",
          blockNumber,
        }),
        this.client.readContract({
          address: tokenAddress,
          abi: domainAbi,
          functionName: "DOMAIN_SEPARATOR",
          blockNumber,
        }),
        this.client.readContract({
          address: tokenAddress,
          abi: daiPermitAbi,
          functionName: "PERMIT_TYPEHASH",
          blockNumber,
        }),
        this.client.readContract({
          address: tokenAddress,
          abi: daiPermitAbi,
          functionName: "nonces",
          args: [source],
          blockNumber,
        }),
      ]);
      const name = safeDomainText(rawName, 128);
      const domain: SigningDomain = {
        name,
        version: "1",
        chainId: this.chain.chain.id,
        verifyingContract: evmAddressSchema.parse(tokenAddress),
      };
      const computed = hashDomain({
        domain: {
          name,
          version: "1",
          chainId: BigInt(this.chain.chain.id),
          verifyingContract: tokenAddress,
        },
        types: domainTypes,
      });
      if (
        !name ||
        typehash.toLowerCase() !== daiTypehash.toLowerCase() ||
        computed.toLowerCase() !== separator.toLowerCase()
      ) {
        return undefined;
      }
      const probe = encodeFunctionData({
        abi: daiPermitAbi,
        functionName: "permit",
        args: [source, destination, nonce, 9_999_999_999n, true, 27, zeroBytes32, zeroBytes32],
      });
      try {
        await this.client.call({
          account: destination,
          to: tokenAddress,
          data: probe,
          blockNumber,
        });
        return undefined;
      } catch {
        return { route: "DAI_PERMIT_ATOMIC_BATCH", domain, nonce };
      }
    } catch {
      return undefined;
    }
  }

  private async buildTokenPackage(
    job: ReadyAgentJob,
    action: Extract<RescueAction, { actionType: "TRANSFER_ERC20" }>,
    simulation: SimulationResult,
    capability: PermitCapability,
    expiresAt: Date,
  ): Promise<SigningPackage> {
    const tokenAction = action;
    const common = {
      schemaVersion: "safeexit-signing-package-v1" as const,
      packageId: `signing-package:${randomUUID()}`,
      jobId: job.id,
      incidentId: job.incident.id,
      planId: job.plan.id,
      planHash: job.plan.integrityHash,
      actionId: tokenAction.id,
      chainId: job.plan.chainId,
      sourceAddress: job.plan.sourceAddress,
      destinationAddress: job.plan.destinationAddress,
      observedAtBlock: job.plan.observedAtBlock,
      expiresAt: expiresAt.toISOString(),
      tokenAddress: tokenAction.parameters.tokenAddress,
      amount: tokenAction.parameters.amount,
      simulation: {
        resultId: simulation.id,
        providerId: simulation.providerId,
        status: "SUCCEEDED" as const,
        expiresAt: simulation.expiresAt,
      },
      policy: packagePolicy(),
    };
    const expiry = String(Math.floor(expiresAt.getTime() / 1_000));
    if (capability.route === "ERC3009_RECEIVE_WITH_AUTHORIZATION") {
      const now = Math.floor(this.clock().getTime() / 1_000);
      const nonce = await this.createUnusedEip3009Nonce(
        tokenAction.parameters.tokenAddress as Address,
        job.plan.sourceAddress as Address,
      );
      return {
        ...common,
        route: capability.route,
        sourceSigningRequests: [{
          id: "source-transfer-authorization",
          signer: job.plan.sourceAddress,
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
            domain: capability.domain,
            message: {
              from: job.plan.sourceAddress,
              to: job.plan.destinationAddress,
              value: tokenAction.parameters.amount,
              validAfter: String(Math.max(0, now - 30)),
              validBefore: expiry,
              nonce,
            },
          },
        }],
        destinationSettlement: {
          executor: job.plan.destinationAddress,
          payer: "DESTINATION",
          assembly: "BUYER_LOCAL_RUNTIME",
          atomicRequired: false,
          operations: ["RECEIVE_WITH_AUTHORIZATION"],
        },
      };
    }
    if (capability.route === "ERC2612_PERMIT_ATOMIC_BATCH") {
      return {
        ...common,
        route: capability.route,
        sourceSigningRequests: [{
          id: "source-permit",
          signer: job.plan.sourceAddress,
          method: "EIP712",
          rpcMethod: "eth_signTypedData_v4",
          typedData: {
            primaryType: "Permit",
            types: {
              EIP712Domain: [...SIGNING_PACKAGE_EIP712_TYPES.EIP712Domain],
              Permit: [...SIGNING_PACKAGE_EIP712_TYPES.ERC2612Permit],
            },
            domain: capability.domain,
            message: {
              owner: job.plan.sourceAddress,
              spender: job.plan.destinationAddress,
              value: tokenAction.parameters.amount,
              nonce: capability.nonce.toString(),
              deadline: expiry,
            },
          },
        }],
        destinationSettlement: {
          executor: job.plan.destinationAddress,
          payer: "DESTINATION",
          assembly: "BUYER_LOCAL_RUNTIME",
          atomicRequired: true,
          operations: ["PERMIT_ERC2612", "TRANSFER_FROM_ERC20"],
        },
      };
    }
    return {
      ...common,
      route: capability.route,
      sourceSigningRequests: [
        {
          id: "source-allow-permit",
          signer: job.plan.sourceAddress,
          method: "EIP712",
          rpcMethod: "eth_signTypedData_v4",
          typedData: {
            primaryType: "Permit",
            types: {
              EIP712Domain: [...SIGNING_PACKAGE_EIP712_TYPES.EIP712Domain],
              Permit: [...SIGNING_PACKAGE_EIP712_TYPES.DaiPermit],
            },
            domain: capability.domain,
            message: {
              holder: job.plan.sourceAddress,
              spender: job.plan.destinationAddress,
              nonce: capability.nonce.toString(),
              expiry,
              allowed: true,
            },
          },
        },
        {
          id: "source-revoke-permit",
          signer: job.plan.sourceAddress,
          method: "EIP712",
          rpcMethod: "eth_signTypedData_v4",
          typedData: {
            primaryType: "Permit",
            types: {
              EIP712Domain: [...SIGNING_PACKAGE_EIP712_TYPES.EIP712Domain],
              Permit: [...SIGNING_PACKAGE_EIP712_TYPES.DaiPermit],
            },
            domain: capability.domain,
            message: {
              holder: job.plan.sourceAddress,
              spender: job.plan.destinationAddress,
              nonce: (capability.nonce + 1n).toString(),
              expiry,
              allowed: false,
            },
          },
        },
      ],
      destinationSettlement: {
        executor: job.plan.destinationAddress,
        payer: "DESTINATION",
        assembly: "BUYER_LOCAL_RUNTIME",
        atomicRequired: true,
        operations: [
          "PERMIT_DAI_ALLOW",
          "TRANSFER_FROM_ERC20",
          "PERMIT_DAI_REVOKE",
        ],
      },
    };
  }

  private async createUnusedEip3009Nonce(
    tokenAddress: Address,
    sourceAddress: Address,
  ): Promise<Hex> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const nonce = `0x${randomBytes(32).toString("hex")}` as Hex;
      const used = await this.client.readContract({
        address: tokenAddress,
        abi: eip3009Abi,
        functionName: "authorizationState",
        args: [sourceAddress, nonce],
      });
      if (!used) {
        return nonce;
      }
    }
    throw new Error("Unable to issue an unused ERC-3009 authorization nonce");
  }

  private packageExpiry(now: Date, simulationExpiryValue: string): Date {
    const simulationExpiry = Date.parse(simulationExpiryValue);
    const expiry = Math.min(now.getTime() + 240_000, simulationExpiry - 10_000);
    if (!Number.isFinite(simulationExpiry) || expiry <= now.getTime() + 30_000) {
      throw new Error("Simulation expires too soon for local signing");
    }
    return new Date(expiry);
  }
}
