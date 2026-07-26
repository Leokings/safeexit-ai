import type { ChainAdapterConfig } from "@safeexit/chain/config";
import {
  createPublicClient,
  createWalletClient,
  custom,
  getAddress,
  http,
  type EIP1193Provider,
  type Hex,
  type LocalAccount,
} from "viem";

import { ViemLocalEip7702DestinationTransport } from "./eip7702-viem";

const EMPTY_CODE = "0x";
const MINIMUM_GAS_BUDGET = 100_000_000_000_000n;
const MAXIMUM_GAS_BUDGET = 5_000_000_000_000_000n;
const BASE_GAS_UNITS = 4_000_000n;
const GAS_UNITS_PER_ACTION = 500_000n;
const GAS_PRICE_SAFETY_MULTIPLIER = 2n;

export type Eip1193FundingProvider = {
  request(input: {
    method: string;
    params?: readonly unknown[];
  }): Promise<unknown>;
};

function sameAddress(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function parseChainId(value: unknown): number {
  if (typeof value !== "string" || !/^0x[0-9a-f]+$/i.test(value)) {
    throw new Error("The funding wallet returned an invalid chain ID");
  }
  return Number(BigInt(value));
}

function parseActiveAddress(value: unknown): `0x${string}` {
  if (!Array.isArray(value) || typeof value[0] !== "string") {
    throw new Error("The funding wallet did not return an active account");
  }
  return getAddress(value[0]);
}

export function calculateEip7702GasBudget(input: {
  gasPrice: bigint;
  actionCount: number;
}): bigint {
  if (input.gasPrice <= 0n) {
    throw new Error("A positive gas price is required");
  }
  if (
    !Number.isSafeInteger(input.actionCount) ||
    input.actionCount < 1 ||
    input.actionCount > 256
  ) {
    throw new Error("The EIP-7702 action count is outside the supported range");
  }
  const units =
    BASE_GAS_UNITS + BigInt(input.actionCount) * GAS_UNITS_PER_ACTION;
  const calculated =
    input.gasPrice * units * GAS_PRICE_SAFETY_MULTIPLIER;
  const budget =
    calculated < MINIMUM_GAS_BUDGET
      ? MINIMUM_GAS_BUDGET
      : calculated;
  if (budget > MAXIMUM_GAS_BUDGET) {
    throw new Error(
      "The calculated temporary gas budget exceeds SafeExit's 0.005 OKB cap",
    );
  }
  return budget;
}

export class ViemFundedEip7702PayerSession {
  readonly payerAddress: `0x${string}`;
  readonly transport: ViemLocalEip7702DestinationTransport;

  private readonly publicClient;
  private readonly fundingWalletClient;
  private readonly payerWalletClient;

  constructor(
    private readonly chain: ChainAdapterConfig,
    rpcUrl: string,
    private readonly fundingProvider: Eip1193FundingProvider,
    private readonly fundingAddress: `0x${string}`,
    private readonly refundAddress: `0x${string}`,
    payerAccount: LocalAccount,
  ) {
    const validatedRpcUrl = new URL(rpcUrl);
    if (validatedRpcUrl.protocol !== "https:") {
      throw new Error("The temporary payer requires an HTTPS RPC URL");
    }
    this.payerAddress = getAddress(payerAccount.address);
    if (
      sameAddress(this.payerAddress, fundingAddress) ||
      sameAddress(this.payerAddress, refundAddress)
    ) {
      throw new Error("The temporary gas payer must be a separate account");
    }
    this.publicClient = createPublicClient({
      chain: chain.chain,
      transport: http(validatedRpcUrl.toString(), {
        retryCount: 2,
        timeout: 10_000,
      }),
    });
    this.fundingWalletClient = createWalletClient({
      account: getAddress(fundingAddress),
      chain: chain.chain,
      transport: custom(fundingProvider as EIP1193Provider),
    });
    this.payerWalletClient = createWalletClient({
      account: payerAccount,
      chain: chain.chain,
      transport: http(validatedRpcUrl.toString(), {
        retryCount: 2,
        timeout: 10_000,
      }),
    });
    this.transport = new ViemLocalEip7702DestinationTransport(
      chain,
      validatedRpcUrl.toString(),
      payerAccount,
    );
  }

  private async assertFundingWallet(): Promise<void> {
    const [chainIdValue, accountsValue] = await Promise.all([
      this.fundingProvider.request({ method: "eth_chainId" }),
      this.fundingProvider.request({ method: "eth_accounts" }),
    ]);
    if (parseChainId(chainIdValue) !== this.chain.chain.id) {
      throw new Error("The funding wallet left the committed rescue chain");
    }
    const activeAddress = parseActiveAddress(accountsValue);
    if (!sameAddress(activeAddress, this.fundingAddress)) {
      throw new Error("The active funding wallet changed before gas funding");
    }
  }

  async calculateGasBudget(actionCount: number): Promise<bigint> {
    return calculateEip7702GasBudget({
      gasPrice: await this.publicClient.getGasPrice(),
      actionCount,
    });
  }

  async fundGasBudget(amount: bigint): Promise<Hex> {
    if (amount < MINIMUM_GAS_BUDGET || amount > MAXIMUM_GAS_BUDGET) {
      throw new Error(
        "The temporary gas funding amount is outside SafeExit's capped budget",
      );
    }
    await this.assertFundingWallet();
    const [nonce, codeValue, existingBalance] = await Promise.all([
      this.publicClient.getTransactionCount({
        address: this.payerAddress,
        blockTag: "pending",
      }),
      this.publicClient.getCode({ address: this.payerAddress }),
      this.publicClient.getBalance({ address: this.payerAddress }),
    ]);
    if (
      nonce !== 0 ||
      (codeValue ?? EMPTY_CODE) !== EMPTY_CODE ||
      existingBalance !== 0n
    ) {
      throw new Error("The generated temporary payer is not a fresh empty EOA");
    }

    const hash = await this.fundingWalletClient.sendTransaction({
      account: getAddress(this.fundingAddress),
      chain: this.chain.chain,
      to: this.payerAddress,
      value: amount,
    });
    const receipt = await this.transport.waitForReceipt(hash);
    if (receipt.status !== "CONFIRMED") {
      throw new Error(
        receipt.failureReason ?? "The temporary gas funding transaction failed",
      );
    }
    const fundedBalance = await this.publicClient.getBalance({
      address: this.payerAddress,
    });
    if (fundedBalance < amount) {
      throw new Error("The temporary payer did not receive its capped gas budget");
    }
    return hash;
  }

  async refundUnusedGas(): Promise<{
    transactionHash?: Hex;
    refunded: bigint;
    residual: bigint;
  }> {
    const balance = await this.publicClient.getBalance({
      address: this.payerAddress,
    });
    if (balance === 0n) {
      return { refunded: 0n, residual: 0n };
    }

    const gasPrice = await this.publicClient.getGasPrice();
    const estimatedGas = await this.publicClient.estimateGas({
      account: this.payerAddress,
      to: getAddress(this.refundAddress),
      value: balance / 2n,
    });
    const gasLimit = estimatedGas + estimatedGas / 5n + 1n;
    const feeReserve = gasLimit * gasPrice;
    if (balance <= feeReserve) {
      return { refunded: 0n, residual: balance };
    }

    const refunded = balance - feeReserve;
    const hash = await this.payerWalletClient.sendTransaction({
      account: this.payerWalletClient.account!,
      chain: this.chain.chain,
      to: getAddress(this.refundAddress),
      value: refunded,
      gas: gasLimit,
      gasPrice,
    });
    const receipt = await this.transport.waitForReceipt(hash);
    if (receipt.status !== "CONFIRMED") {
      throw new Error(
        receipt.failureReason ?? "The unused gas refund transaction failed",
      );
    }
    return {
      transactionHash: hash,
      refunded,
      residual: await this.publicClient.getBalance({
        address: this.payerAddress,
      }),
    };
  }
}
