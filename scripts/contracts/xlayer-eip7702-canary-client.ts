import {
  EIP7702_ACTION_KIND,
  eip7702RescueDelegateFactoryAbi,
  hashEip7702RescuePlan,
  type Eip7702RescueAction,
} from "@safeexit/adapters/eip7702-rescue";
import {
  eip7702LocalSigningPackageSchema,
  type Eip7702LocalSigningPackage,
} from "@safeexit/agent-service/eip7702-signing-package";
import type { Eip1193Provider } from "@safeexit/buyer-runtime/eip1193";
import {
  assessEip5792Capabilities,
  createEip5792CapabilityEvidence,
  XLAYER_MAINNET_HEX_CHAIN_ID,
} from "@safeexit/buyer-runtime/eip5792-capabilities";
import {
  LocalEip7702RescueRuntime,
  XLAYER_SAFEEXIT_EIP7702_FACTORY_V2,
  type Eip7702DestinationTransportPort,
  type Eip7702LocalSimulation,
  type Eip7702LocalTransactionRequest,
  type Eip7702PackageInspection,
} from "@safeexit/buyer-runtime/eip7702-runtime";
import {
  requestEip7702SourceSignerFromExtension,
} from "@safeexit/buyer-runtime/eip7702-extension-bridge";
import {
  ViemLocalEip7702DestinationTransport,
} from "@safeexit/buyer-runtime/eip7702-viem";
import type { DestinationReceipt } from "@safeexit/buyer-runtime/schemas";
import {
  getRescueFinalityPolicy,
  xLayerMainnet,
  xLayerMainnetConfig,
} from "@safeexit/chain/config";
import {
  concatHex,
  createPublicClient,
  createWalletClient,
  custom,
  formatEther,
  getAddress,
  http,
  isAddress,
  keccak256,
  type Hex,
  type LocalAccount,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const RPC_URL = "https://rpc.xlayer.tech";
const TEST_TOKEN = getAddress("0x299D0c59ff5cAEA7b5480fEE3650Eba88B9fb1cd");
const EMPTY_CODE = "0x";
const MINIMUM_GAS_BUDGET = 100_000_000_000_000n;
const MAXIMUM_GAS_BUDGET = 1_000_000_000_000_000n;
const CANARY_GAS_BUDGET_UNITS = 4_000_000n;
const EXPLORER_TRANSACTION =
  "https://www.okx.com/web3/explorer/xlayer/tx/";

type BrowserHost = Window & {
  okxwallet?: Eip1193Provider;
  ethereum?: Eip1193Provider & {
    isOkxWallet?: boolean;
    isOKExWallet?: boolean;
    providers?: Array<
      Eip1193Provider & {
        isOkxWallet?: boolean;
        isOKExWallet?: boolean;
      }
    >;
  };
};

type AnnouncedProvider = {
  info?: { name?: string; rdns?: string };
  provider?: Eip1193Provider & {
    isOkxWallet?: boolean;
    isOKExWallet?: boolean;
  };
};

function element(id: string): HTMLElement {
  const value = document.getElementById(id);
  if (!value) throw new Error(`Missing canary element: ${id}`);
  return value;
}

function button(id: string): HTMLButtonElement {
  const value = element(id);
  if (!(value instanceof HTMLButtonElement)) {
    throw new Error(`Canary element is not a button: ${id}`);
  }
  return value;
}

function checkbox(id: string): HTMLInputElement {
  const value = element(id);
  if (!(value instanceof HTMLInputElement) || value.type !== "checkbox") {
    throw new Error(`Canary element is not a checkbox: ${id}`);
  }
  return value;
}

function textInput(id: string): HTMLInputElement {
  const value = element(id);
  if (!(value instanceof HTMLInputElement) || value.type !== "text") {
    throw new Error(`Canary element is not a text input: ${id}`);
  }
  return value;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message.slice(0, 1_000);
  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    const nested =
      record.data && typeof record.data === "object"
        ? (record.data as Record<string, unknown>).message
        : undefined;
    const values = [
      typeof record.message === "string" ? record.message : undefined,
      typeof nested === "string" ? nested : undefined,
      record.code === undefined ? undefined : `code ${String(record.code)}`,
    ].filter((value): value is string => Boolean(value));
    if (values.length > 0) return values.join(" / ").slice(0, 1_000);
  }
  return "Unknown canary failure";
}

function parseAccounts(value: unknown): `0x${string}` {
  if (!Array.isArray(value) || typeof value[0] !== "string" || !isAddress(value[0])) {
    throw new Error("OKX Wallet did not return a valid active account");
  }
  return getAddress(value[0]);
}

function parseChainId(value: unknown): number {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]+$/.test(value)) {
    throw new Error("OKX Wallet returned an invalid chain ID");
  }
  const chainId = Number(BigInt(value));
  if (!Number.isSafeInteger(chainId) || chainId <= 0) {
    throw new Error("OKX Wallet returned an unsupported chain ID");
  }
  return chainId;
}

function sameAddress(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function status(message: string): void {
  element("status").textContent = message;
}

function probeStatus(message: string): void {
  element("probe-status").textContent = message;
}

function setText(id: string, value: string): void {
  element(id).textContent = value;
}

function addTransaction(label: string, hash: Hex): void {
  const row = document.createElement("div");
  row.className = "transaction";
  const name = document.createElement("span");
  name.textContent = `${label}: `;
  const link = document.createElement("a");
  link.href = `${EXPLORER_TRANSACTION}${hash}`;
  link.target = "_blank";
  link.rel = "noreferrer";
  link.textContent = hash;
  row.append(name, link);
  element("transactions").appendChild(row);
}

function providerCode(error: unknown): number | undefined {
  return error && typeof error === "object" && "code" in error
    ? Number((error as { code?: unknown }).code)
    : undefined;
}

async function discoverOkxProvider(): Promise<Eip1193Provider | undefined> {
  const host = window as BrowserHost;
  if (host.okxwallet) return host.okxwallet;
  const injected = host.ethereum?.providers?.find(
    (candidate) => candidate.isOkxWallet || candidate.isOKExWallet,
  );
  if (injected) return injected;
  if (host.ethereum?.isOkxWallet || host.ethereum?.isOKExWallet) {
    return host.ethereum;
  }

  let announced: Eip1193Provider | undefined;
  const listener = (event: Event) => {
    const detail = (event as CustomEvent<AnnouncedProvider>).detail;
    const name = String(detail?.info?.name ?? "").toLowerCase();
    const rdns = String(detail?.info?.rdns ?? "").toLowerCase();
    if (
      detail?.provider?.isOkxWallet ||
      detail?.provider?.isOKExWallet ||
      name === "okx wallet" ||
      rdns.includes("okx") ||
      rdns.includes("okex")
    ) {
      announced = detail.provider;
    }
  };
  window.addEventListener("eip6963:announceProvider", listener);
  window.dispatchEvent(new Event("eip6963:requestProvider"));
  await new Promise((resolve) => window.setTimeout(resolve, 500));
  window.removeEventListener("eip6963:announceProvider", listener);
  return announced;
}

async function ensureXLayer(provider: Eip1193Provider): Promise<void> {
  if (parseChainId(await provider.request({ method: "eth_chainId" })) === 196) {
    return;
  }
  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: "0xc4" }],
    });
  } catch (error) {
    if (providerCode(error) !== 4902) throw error;
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: "0xc4",
          chainName: "X Layer",
          nativeCurrency: { name: "OKB", symbol: "OKB", decimals: 18 },
          rpcUrls: [RPC_URL, "https://xlayerrpc.okx.com"],
          blockExplorerUrls: ["https://www.okx.com/web3/explorer/xlayer"],
        },
      ],
    });
  }
}

class FundedLocalCanaryDestinationTransport
implements Eip7702DestinationTransportPort {
  private readonly publicClient = createPublicClient({
    chain: xLayerMainnet,
    transport: http(RPC_URL, { retryCount: 2, timeout: 10_000 }),
  });

  private readonly fundingWalletClient;
  private readonly localWalletClient;
  private readonly inner: ViemLocalEip7702DestinationTransport;

  constructor(
    private readonly provider: Eip1193Provider,
    private readonly fundingAddress: `0x${string}`,
    private readonly localDestinationAccount: LocalAccount,
  ) {
    this.fundingWalletClient = createWalletClient({
      account: fundingAddress,
      chain: xLayerMainnet,
      transport: custom(provider),
    });
    this.localWalletClient = createWalletClient({
      account: localDestinationAccount,
      chain: xLayerMainnet,
      transport: http(RPC_URL, { retryCount: 2, timeout: 10_000 }),
    });
    this.inner = new ViemLocalEip7702DestinationTransport(
      xLayerMainnetConfig,
      RPC_URL,
      localDestinationAccount,
    );
  }

  private async assertFundingSession(): Promise<void> {
    const [activeAddress, chainId] = await Promise.all([
      parseAccounts(await this.provider.request({ method: "eth_accounts" })),
      parseChainId(await this.provider.request({ method: "eth_chainId" })),
    ]);
    if (!sameAddress(activeAddress, this.fundingAddress)) {
      throw new Error("The active OKX funding account changed during the canary");
    }
    if (chainId !== 196) {
      throw new Error("OKX Wallet left X Layer during the canary");
    }
  }

  async fundGasBudget(amount: bigint): Promise<Hex> {
    await this.assertFundingSession();
    status(
      `Wallet confirmation: temporarily fund ${formatEther(amount)} OKB for the local destination signer.`,
    );
    const hash = await this.fundingWalletClient.sendTransaction({
      account: this.fundingAddress,
      chain: xLayerMainnet,
      to: getAddress(this.localDestinationAccount.address),
      value: amount,
    });
    addTransaction("Temporary gas funding", hash);
    const receipt = await this.waitForReceipt(hash);
    if (receipt.status !== "CONFIRMED") {
      throw new Error(receipt.failureReason ?? "Canary gas funding failed");
    }
    const fundedBalance = await this.publicClient.getBalance({
      address: getAddress(this.localDestinationAccount.address),
    });
    if (fundedBalance < amount) {
      throw new Error("The local destination signer did not receive its gas budget");
    }
    return hash;
  }

  async refundUnusedGas(): Promise<{
    transactionHash?: Hex;
    refunded: bigint;
    residual: bigint;
  }> {
    const destination = getAddress(this.localDestinationAccount.address);
    const balance = await this.publicClient.getBalance({ address: destination });
    if (balance === 0n) {
      return { refunded: 0n, residual: 0n };
    }

    status("Returning unused canary gas to the connected OKX funding wallet.");
    const gasPrice = await this.publicClient.getGasPrice();
    const estimatedGas = await this.publicClient.estimateGas({
      account: destination,
      to: this.fundingAddress,
      value: balance / 2n,
    });
    const gasLimit = estimatedGas + estimatedGas / 10n + 1n;
    const feeReserve = gasLimit * gasPrice;
    if (balance <= feeReserve) {
      return { refunded: 0n, residual: balance };
    }

    const refunded = balance - feeReserve;
    const hash = await this.localWalletClient.sendTransaction({
      account: this.localDestinationAccount,
      chain: xLayerMainnet,
      to: this.fundingAddress,
      value: refunded,
      gas: gasLimit,
      gasPrice,
    });
    addTransaction("Unused gas refund", hash);
    const receipt = await this.waitForReceipt(hash);
    if (receipt.status !== "CONFIRMED") {
      throw new Error(receipt.failureReason ?? "Unused gas refund failed");
    }
    const residual = await this.publicClient.getBalance({ address: destination });
    return { transactionHash: hash, refunded, residual };
  }

  async finalEvidence(
    signingPackage: Eip7702LocalSigningPackage,
  ): Promise<{
    sourceCode: Hex;
    sourceNonce: number;
    sourceBalance: bigint;
    allowance: bigint;
  }> {
    const sourceAddress = getAddress(signingPackage.sourceAddress);
    const [sourceCodeValue, sourceNonce, sourceBalance, allowance] =
      await Promise.all([
        this.publicClient.getCode({ address: sourceAddress }),
        this.publicClient.getTransactionCount({
          address: sourceAddress,
          blockTag: "latest",
        }),
        this.publicClient.getBalance({ address: sourceAddress }),
        this.publicClient.readContract({
          address: TEST_TOKEN,
          abi: [
            {
              type: "function",
              name: "allowance",
              stateMutability: "view",
              inputs: [
                { name: "owner", type: "address" },
                { name: "spender", type: "address" },
              ],
              outputs: [{ name: "", type: "uint256" }],
            },
          ] as const,
          functionName: "allowance",
          args: [sourceAddress, getAddress(this.localDestinationAccount.address)],
        }),
      ]);
    return {
      sourceCode: sourceCodeValue ?? EMPTY_CODE,
      sourceNonce,
      sourceBalance,
      allowance,
    };
  }

  async getAddress(): Promise<`0x${string}`> {
    return this.inner.getAddress();
  }

  async getChainId(): Promise<number> {
    return this.inner.getChainId();
  }

  async inspect(
    signingPackage: Eip7702LocalSigningPackage,
  ): Promise<Eip7702PackageInspection> {
    return this.inner.inspect(signingPackage);
  }

  async deployDelegate(
    signingPackage: Eip7702LocalSigningPackage,
  ): Promise<Hex> {
    status("The funded local destination signer is deploying the incident delegate.");
    const hash = await this.inner.deployDelegate(signingPackage);
    addTransaction("Delegate deployment", hash);
    return hash;
  }

  async simulate(
    request: Eip7702LocalTransactionRequest,
  ): Promise<Eip7702LocalSimulation> {
    status("Simulating the exact delegated canary call with its authorization.");
    const simulation = await this.inner.simulate(request);
    setText(
      "simulation",
      simulation.status === "SUCCEEDED"
        ? "SUCCEEDED"
        : `FAILED: ${simulation.failureReason ?? "Unknown simulation failure"}`,
    );
    return simulation;
  }

  async submit(request: Eip7702LocalTransactionRequest): Promise<Hex> {
    status(
      request.purpose === "CLEAR_DELEGATION"
        ? "The local destination signer is submitting the type-4 clearing transaction."
        : "The local destination signer is submitting the type-4 delegated canary.",
    );
    const hash = await this.inner.submit(request);
    addTransaction(
      request.purpose === "CLEAR_DELEGATION"
        ? "Delegation clearing"
        : "Delegated canary",
      hash,
    );
    return hash;
  }

  async waitForReceipt(hash: Hex): Promise<DestinationReceipt> {
    const policy = getRescueFinalityPolicy(196);
    status(
      `Waiting for ${policy.minimumConfirmations} canonical confirmations: ${hash.slice(0, 12)}...`,
    );
    return this.inner.waitForReceipt(hash);
  }
}

async function buildFreshCanaryPackage(
  sourceAddress: `0x${string}`,
  destinationAddress: `0x${string}`,
): Promise<{
  signingPackage: Eip7702LocalSigningPackage;
  delegateAddress: `0x${string}`;
  expiresAt: string;
}> {
  const publicClient = createPublicClient({
    chain: xLayerMainnet,
    transport: http(RPC_URL, { retryCount: 2, timeout: 10_000 }),
  });
  const action: Eip7702RescueAction = {
    kind: EIP7702_ACTION_KIND.REVOKE_ERC20_APPROVAL,
    asset: TEST_TOKEN,
    counterparty: destinationAddress,
    tokenId: 0n,
    amount: 0n,
  };
  const delegatePlanHash = hashEip7702RescuePlan([action]);
  const rescueNonce = keccak256(generatePrivateKey());
  const plannerPlanHash = keccak256(
    concatHex([sourceAddress, destinationAddress, rescueNonce]),
  );
  const nowSeconds = Math.floor(Date.now() / 1_000);
  const deadline = nowSeconds + 14 * 60;
  const expiresAt = new Date(deadline * 1_000).toISOString();
  const [sourceNonce, sourceCodeValue, sourceBalance, factoryCode, tokenCode, block] =
    await Promise.all([
      publicClient.getTransactionCount({
        address: sourceAddress,
        blockTag: "pending",
      }),
      publicClient.getCode({ address: sourceAddress }),
      publicClient.getBalance({ address: sourceAddress }),
      publicClient.getCode({
        address: XLAYER_SAFEEXIT_EIP7702_FACTORY_V2.address,
      }),
      publicClient.getCode({ address: TEST_TOKEN }),
      publicClient.getBlockNumber(),
    ]);
  const sourceStateFailures = [
    (sourceCodeValue ?? EMPTY_CODE) !== EMPTY_CODE
      ? "account code is present"
      : undefined,
    sourceBalance !== 0n
      ? `native balance is ${formatEther(sourceBalance)} OKB`
      : undefined,
    sourceNonce !== 0 ? `transaction nonce is ${sourceNonce}` : undefined,
  ].filter((value): value is string => Boolean(value));
  if (sourceStateFailures.length > 0) {
    throw new Error(
      `The no-value canary requires a fresh empty source; ${sourceStateFailures.join(", ")}. Do not fund the source because the destination pays gas.`,
    );
  }
  if (
    !factoryCode ||
    factoryCode === EMPTY_CODE ||
    keccak256(factoryCode).toLowerCase() !==
      XLAYER_SAFEEXIT_EIP7702_FACTORY_V2.runtimeHash.toLowerCase()
  ) {
    throw new Error("Pinned EIP-7702 factory bytecode verification failed");
  }
  if (!tokenCode || tokenCode === EMPTY_CODE) {
    throw new Error("The fixed no-value canary token is not deployed");
  }
  const delegateAddress = await publicClient.readContract({
    address: XLAYER_SAFEEXIT_EIP7702_FACTORY_V2.address,
    abi: eip7702RescueDelegateFactoryAbi,
    functionName: "predictDelegate",
    args: [
      sourceAddress,
      destinationAddress,
      BigInt(deadline),
      delegatePlanHash,
      rescueNonce,
    ],
  });
  const packageId = `canary-${rescueNonce.slice(2, 18)}`;
  const signingPackage = eip7702LocalSigningPackageSchema.parse({
    schemaVersion: "safeexit-eip7702-signing-package-v1",
    packageId,
    jobId: packageId,
    incidentId: packageId,
    planId: packageId,
    planHash: plannerPlanHash,
    delegatePlanHash,
    route: "EIP7702_DELEGATED_RESCUE",
    chainId: 196,
    sourceAddress,
    destinationAddress,
    observedAtBlock: block.toString(),
    expiresAt,
    deadline,
    sourceNonce,
    rescueNonce,
    factoryAddress: XLAYER_SAFEEXIT_EIP7702_FACTORY_V2.address,
    factoryRuntimeHash: XLAYER_SAFEEXIT_EIP7702_FACTORY_V2.runtimeHash,
    delegateAddress,
    actionIds: ["canary-revoke-zero-allowance"],
    actions: [
      {
        kind: action.kind,
        asset: action.asset,
        counterparty: action.counterparty,
        tokenId: action.tokenId.toString(),
        amount: action.amount.toString(),
      },
    ],
    executionIndexes: [0],
    simulation: {
      resultIds: ["canary-structural-preflight"],
      providerId: "safeexit-mainnet-canary-structural-v1",
      status: "SUCCEEDED",
      expiresAt: new Date((deadline + 60) * 1_000).toISOString(),
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
  return { signingPackage, delegateAddress, expiresAt };
}

const connectButton = button("connect");
const prepareButton = button("prepare");
const executeButton = button("execute");
const confirmation = checkbox("confirm");
const sourceInput = textInput("canary-source");
const probeConnectButton = button("probe-connect");
const probeCheckButton = button("probe-check");
let provider: Eip1193Provider | undefined;
let fundingAddress: `0x${string}` | undefined;
let probeProvider: Eip1193Provider | undefined;
let probeAddress: `0x${string}` | undefined;
let sourceAddress: `0x${string}` | undefined;
let localDestinationAccount: ReturnType<typeof privateKeyToAccount> | undefined;
let signingPackage: Eip7702LocalSigningPackage | undefined;
let gasBudget = 0n;
let destinationTransport: FundedLocalCanaryDestinationTransport | undefined;

function refreshButtons(): void {
  probeCheckButton.disabled = !probeProvider || !probeAddress;
  prepareButton.disabled =
    !provider ||
    !fundingAddress ||
    !isAddress(sourceInput.value.trim());
  executeButton.disabled =
    !signingPackage ||
    !destinationTransport ||
    !sourceAddress ||
    !localDestinationAccount ||
    gasBudget === 0n ||
    !confirmation.checked;
}

confirmation.addEventListener("change", refreshButtons);
sourceInput.addEventListener("input", () => {
  sourceAddress = undefined;
  signingPackage = undefined;
  destinationTransport = undefined;
  localDestinationAccount = undefined;
  gasBudget = 0n;
  setText("source", "Not prepared");
  setText("destination", "Not generated");
  setText("delegate", "Not predicted");
  setText("expiry", "Not prepared");
  setText("gas", "Not calculated");
  refreshButtons();
});

probeConnectButton.addEventListener("click", async () => {
  probeConnectButton.disabled = true;
  probeCheckButton.disabled = true;
  try {
    probeStatus("Waiting for the source account connection approval.");
    const discoveredProvider = await discoverOkxProvider();
    if (!discoveredProvider) {
      throw new Error("OKX Wallet is not available for this localhost page");
    }
    const connectedAddress = parseAccounts(
      await discoveredProvider.request({ method: "eth_requestAccounts" }),
    );
    await ensureXLayer(discoveredProvider);
    probeProvider = discoveredProvider;
    probeAddress = connectedAddress;
    setText("probe-account", connectedAddress);
    setText("probe-capabilities", "Ready to query wallet_getCapabilities");
    setText("probe-route", "NOT CHECKED");
    probeStatus(
      "Source account connected on X Layer. The next check is read-only.",
    );
  } catch (error) {
    probeProvider = undefined;
    probeAddress = undefined;
    setText("probe-account", "Not connected");
    setText("probe-capabilities", "Not checked");
    setText("probe-route", "NOT CHECKED");
    probeStatus(errorMessage(error));
  } finally {
    probeConnectButton.disabled = false;
    refreshButtons();
  }
});

probeCheckButton.addEventListener("click", async () => {
  if (!probeProvider || !probeAddress) return;
  probeCheckButton.disabled = true;
  try {
    const activeAddress = parseAccounts(
      await probeProvider.request({ method: "eth_accounts" }),
    );
    if (!sameAddress(activeAddress, probeAddress)) {
      throw new Error(
        "The active OKX account changed. Reconnect the intended source before checking capabilities.",
      );
    }
    probeStatus("Reading the wallet's X Layer capability advertisement.");
    const capabilityValue = await probeProvider.request({
      method: "wallet_getCapabilities",
      params: [probeAddress, [XLAYER_MAINNET_HEX_CHAIN_ID]],
    });
    const assessment = assessEip5792Capabilities(capabilityValue);
    const evidence = createEip5792CapabilityEvidence({
      walletAddress: probeAddress,
      capabilities: capabilityValue,
    });
    setText(
      "probe-capabilities",
      JSON.stringify(evidence, null, 2).slice(0, 4_000),
    );
    setText(
      "probe-route",
      `${assessment.status}: ${assessment.reason}`,
    );
    probeStatus(
      assessment.safeExitDestinationPaidReady
        ? "A destination-paid candidate was advertised. Execution remains disabled pending adapter verification."
        : "No verified raw source-authorization plus separate destination-payer route was advertised. No transaction was requested.",
    );
  } catch (error) {
    setText("probe-capabilities", `Unavailable: ${errorMessage(error)}`);
    setText(
      "probe-route",
      "NOT ADVERTISED: no verified browser authorization adapter",
    );
    probeStatus(
      "Capability check failed closed. No signature or transaction was requested.",
    );
  } finally {
    refreshButtons();
  }
});

connectButton.addEventListener("click", async () => {
  connectButton.disabled = true;
  try {
    status("Waiting for OKX Wallet connection approval.");
    provider = await discoverOkxProvider();
    if (!provider) {
      throw new Error("OKX Wallet is not available for this localhost page");
    }
    fundingAddress = parseAccounts(
      await provider.request({ method: "eth_requestAccounts" }),
    );
    await ensureXLayer(provider);
    setText("funding", fundingAddress);
    status("Funding wallet connected on X Layer. Prepare the fixed canary package.");
  } catch (error) {
    provider = undefined;
    fundingAddress = undefined;
    status(errorMessage(error));
  } finally {
    connectButton.disabled = false;
    refreshButtons();
  }
});

prepareButton.addEventListener("click", async () => {
  if (!provider || !fundingAddress) return;
  const activeProvider = provider;
  const activeFundingAddress = fundingAddress;
  prepareButton.disabled = true;
  sourceInput.disabled = true;
  try {
    const enteredSource = sourceInput.value.trim();
    if (!isAddress(enteredSource)) {
      throw new Error("Enter the fresh source wallet address used by the extension.");
    }
    status(
      "Generating the local destination signer and verifying the fixed canary scope.",
    );
    const generatedDestinationAccount = privateKeyToAccount(generatePrivateKey());
    sourceAddress = getAddress(enteredSource);
    localDestinationAccount = generatedDestinationAccount;
    const destinationAddress = getAddress(generatedDestinationAccount.address);
    const publicClient = createPublicClient({
      chain: xLayerMainnet,
      transport: http(RPC_URL, { retryCount: 2, timeout: 10_000 }),
    });
    const [
      destinationNonce,
      destinationCodeValue,
      destinationBalance,
      gasPrice,
    ] = await Promise.all([
      publicClient.getTransactionCount({
        address: destinationAddress,
        blockTag: "pending",
      }),
      publicClient.getCode({ address: destinationAddress }),
      publicClient.getBalance({ address: destinationAddress }),
      publicClient.getGasPrice(),
    ]);
    if (
      (destinationCodeValue ?? EMPTY_CODE) !== EMPTY_CODE ||
      destinationBalance !== 0n ||
      destinationNonce !== 0
    ) {
      throw new Error("Generated local destination is not a fresh empty EOA");
    }
    const calculatedGasBudget = gasPrice * CANARY_GAS_BUDGET_UNITS * 2n;
    gasBudget =
      calculatedGasBudget < MINIMUM_GAS_BUDGET
        ? MINIMUM_GAS_BUDGET
        : calculatedGasBudget;
    if (gasBudget > MAXIMUM_GAS_BUDGET) {
      throw new Error(
        `Current gas requires ${formatEther(gasBudget)} OKB, above the canary safety cap`,
      );
    }
    const prepared = await buildFreshCanaryPackage(
      sourceAddress,
      destinationAddress,
    );
    signingPackage = prepared.signingPackage;
    destinationTransport = new FundedLocalCanaryDestinationTransport(
      activeProvider,
      activeFundingAddress,
      generatedDestinationAccount,
    );
    setText("destination", destinationAddress);
    setText("gas", `${formatEther(gasBudget)} OKB`);
    setText("source", sourceAddress);
    setText("delegate", prepared.delegateAddress);
    setText("action", `Revoke zero allowance on ${TEST_TOKEN}`);
    setText("expiry", prepared.expiresAt);
    status(
      "Canary package ready. The source key will be entered only in the SafeExit extension; the local destination key exists only in this tab.",
    );
  } catch (error) {
    sourceAddress = undefined;
    localDestinationAccount = undefined;
    signingPackage = undefined;
    destinationTransport = undefined;
    gasBudget = 0n;
    setText("destination", "Not generated");
    setText("gas", "Not calculated");
    status(errorMessage(error));
  } finally {
    sourceInput.disabled = false;
    prepareButton.disabled = false;
    refreshButtons();
  }
});

executeButton.addEventListener("click", async () => {
  if (
    !sourceAddress ||
    !localDestinationAccount ||
    !signingPackage ||
    !destinationTransport ||
    gasBudget === 0n
  ) {
    return;
  }
  const activeSourceAddress = sourceAddress;
  const activeLocalDestinationAccount = localDestinationAccount;
  let activeSigningPackage = signingPackage;
  const activeDestinationTransport = destinationTransport;
  const activeGasBudget = gasBudget;
  executeButton.disabled = true;
  connectButton.disabled = true;
  prepareButton.disabled = true;
  sourceInput.disabled = true;
  let fundingConfirmed = false;
  let executionError: unknown;
  let refundError: unknown;
  let completedEvidence:
    | {
        sourceCode: Hex;
        sourceNonce: number;
        sourceBalance: bigint;
        allowance: bigint;
      }
    | undefined;
  let refundEvidence:
    | {
        transactionHash?: Hex;
        refunded: bigint;
        residual: bigint;
      }
    | undefined;
  try {
    element("transactions").textContent = "";
    setText("simulation", "PENDING");
    setText("result", "PENDING");
    const refreshed = await buildFreshCanaryPackage(
      activeSourceAddress,
      getAddress(activeLocalDestinationAccount.address),
    );
    activeSigningPackage = refreshed.signingPackage;
    signingPackage = refreshed.signingPackage;
    setText("delegate", refreshed.delegateAddress);
    setText("expiry", refreshed.expiresAt);
    status(
      "Fresh package committed. Review and sign it in the SafeExit Source Signer extension. No gas has been funded yet.",
    );
    const extensionSigner = await requestEip7702SourceSignerFromExtension({
      signingPackageValue: activeSigningPackage,
    });
    status(
      "Source authorizations verified locally. Funding the capped destination gas budget.",
    );
    await activeDestinationTransport.fundGasBudget(activeGasBudget);
    fundingConfirmed = true;
    const runtime = new LocalEip7702RescueRuntime({
      trustedFactory: XLAYER_SAFEEXIT_EIP7702_FACTORY_V2,
    });
    const confirmationValue = {
      schemaVersion: "safeexit-buyer-confirmation-v1",
      packageId: activeSigningPackage.packageId,
      planHash: activeSigningPackage.planHash,
      chainId: activeSigningPackage.chainId,
      sourceAddress: activeSigningPackage.sourceAddress,
      destinationAddress: activeSigningPackage.destinationAddress,
      authorizationConfirmed: true,
      confirmedAt: new Date().toISOString(),
    };
    const provisioned = await runtime.provision(
      activeSigningPackage,
      confirmationValue,
      activeDestinationTransport,
    );
    status("Delegate verified. Simulating the signed authorization package.");
    const authorized = await runtime.authorize(
      provisioned,
      extensionSigner,
    );
    const result = await runtime.execute(authorized);
    completedEvidence = await activeDestinationTransport.finalEvidence(
      activeSigningPackage,
    );
    if (
      result.status !== "COMPLETED" ||
      !result.clearTransactionHash ||
      completedEvidence.sourceCode !== EMPTY_CODE ||
      completedEvidence.sourceNonce < activeSigningPackage.sourceNonce + 2 ||
      completedEvidence.sourceBalance !== 0n ||
      completedEvidence.allowance !== 0n
    ) {
      throw new Error("Canary transactions confirmed but final safety evidence failed");
    }
  } catch (error) {
    executionError = error;
  }

  if (fundingConfirmed) {
    try {
      refundEvidence = await activeDestinationTransport.refundUnusedGas();
    } catch (error) {
      refundError = error;
    }
  }

  try {
    if (executionError || refundError) {
      const failures = [
        executionError
          ? `canary: ${errorMessage(executionError)}`
          : undefined,
        refundError ? `gas refund: ${errorMessage(refundError)}` : undefined,
      ].filter((value): value is string => Boolean(value));
      throw new Error(failures.join("; "));
    }
    if (!completedEvidence || !refundEvidence) {
      throw new Error("Canary finished without complete final evidence");
    }
    setText(
      "result",
      `COMPLETED / source gas 0 / final nonce ${completedEvidence.sourceNonce} / delegation cleared / refunded ${formatEther(refundEvidence.refunded)} OKB / residual ${formatEther(refundEvidence.residual)} OKB`,
    );
    status(
      "No-value type-4 canary completed, raw authorization lists were preserved, and delegation was canonically cleared.",
    );
  } catch (error) {
    setText("result", `FAILED: ${errorMessage(error)}`);
    status(errorMessage(error));
  } finally {
    sourceInput.disabled = false;
    connectButton.disabled = false;
    prepareButton.disabled = false;
    refreshButtons();
  }
});

refreshButtons();
