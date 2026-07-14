"use client";

import Link from "next/link";
import {
  ArrowLeft,
  ExternalLink,
  FileSignature,
  LoaderCircle,
  RefreshCw,
  Send,
  ShieldAlert,
  ShieldCheck,
  TriangleAlert,
  Wallet,
} from "lucide-react";
import { useState } from "react";
import { createPublicClient, getAddress, http, isAddress, type Hex } from "viem";

import { getRescueMainnetChainConfig } from "@safeexit/chain";
import type {
  EvmAddress,
  RescueAction,
  RescueAssetManifest,
} from "@safeexit/shared";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { CopyAddress } from "@/components/copy-address";
import {
  connectOkxWallet,
  ensureRescueMainnet,
  getOkxConnectedAccount,
  getOkxCallsStatus,
  getOkxProvider,
  receiptProvesCommittedTransfer,
  signDaiPermitPair,
  signEip3009Authorization,
  signErc2612Permit,
  signErc4494Permit,
  submitDaiPermitAtomicBatch,
  submitErc2612AtomicBatch,
  submitErc4494AtomicBatch,
  submitEip3009Settlement,
  type SignedRecoveryAuthorization,
} from "@/lib/okx-wallet";
import {
  gaslessRouteKey,
  mainnetPreflightResponseSchema,
  requireReviewedGaslessRoute,
  type MainnetPreflightResponse,
} from "@/lib/mainnet-rescue";

type SubmittedTransaction = {
  actionId: string;
  hash: Hex;
  status: "CONFIRMING" | "CONFIRMED" | "FAILED";
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "The mainnet operation failed";
}

function tokenAddresses(value: string): `0x${string}`[] {
  const values = value.split(/[\s,]+/).map((item) => item.trim()).filter(Boolean);
  const invalid = values.find((item) => !isAddress(item));
  if (invalid) {
    throw new Error(`Invalid ERC-20 contract address: ${invalid}`);
  }
  const unique = [...new Map(values.map((item) => [item.toLowerCase(), item])).values()];
  if (unique.length > 8) {
    throw new Error("A maximum of 8 ERC-20 contracts can be scanned at once");
  }
  return unique as `0x${string}`[];
}

function erc721Assets(value: string): Array<{
  collectionAddress: `0x${string}`;
  tokenId: string;
}> {
  const lines = value.split(/[\r\n,]+/).map((item) => item.trim()).filter(Boolean);
  const assets = lines.map((line) => {
    const match = /^(0x[a-fA-F0-9]{40}):(0|[1-9]\d*)$/.exec(line);
    if (!match || !match[1] || !match[2] || !isAddress(match[1])) {
      throw new Error(`Invalid ERC-721 entry: ${line}. Use collection:tokenId.`);
    }
    return { collectionAddress: getAddress(match[1]), tokenId: match[2] };
  });
  const unique = [
    ...new Map(
      assets.map((asset) => [
        `${asset.collectionAddress.toLowerCase()}:${asset.tokenId}`,
        asset,
      ]),
    ).values(),
  ];
  if (unique.length > 8) {
    throw new Error("A maximum of 8 ERC-721 assets can be scanned at once");
  }
  return unique;
}

function erc1155Assets(value: string): Array<{
  collectionAddress: `0x${string}`;
  tokenId: string;
}> {
  return erc721Assets(value);
}

function nftAssetInput(
  assets: RescueAssetManifest["erc721Assets"] | undefined,
): string {
  return (assets ?? [])
    .map((asset) => `${asset.collectionAddress}:${asset.tokenId}`)
    .join("\n");
}

function actionLabel(actionType: string): string {
  return actionType.toLowerCase().replaceAll("_", " ");
}

function routeLabel(standard: string): string {
  switch (standard) {
    case "ERC3009_RECEIVE_WITH_AUTHORIZATION":
      return "ERC-3009 direct authorization";
    case "ERC2612_PERMIT_ATOMIC_BATCH":
      return "ERC-2612 atomic permit";
    case "DAI_PERMIT_ATOMIC_BATCH":
      return "DAI-style atomic permit and revoke";
    case "ERC4494_PERMIT_ATOMIC_BATCH":
      return "ERC-4494 NFT atomic permit";
    default:
      return "Unsupported recovery route";
  }
}

function routeContract(route: MainnetPreflightResponse["gaslessActions"][number]): EvmAddress {
  return route.standard === "ERC4494_PERMIT_ATOMIC_BATCH"
    ? route.collectionAddress
    : route.tokenAddress;
}

function actionTarget(action: RescueAction): EvmAddress {
  switch (action.actionType) {
    case "TRANSFER_NATIVE":
      return action.parameters.recipient;
    case "TRANSFER_ERC20":
    case "REVOKE_ERC20_APPROVAL":
      return action.parameters.tokenAddress;
    case "TRANSFER_ERC721":
    case "TRANSFER_ERC1155":
    case "REVOKE_NFT_OPERATOR":
      return action.parameters.collectionAddress;
    case "CLAIM_SUPPORTED_AIRDROP":
    case "WITHDRAW_SUPPORTED_POSITION":
    case "CUSTOM_SUPPORTED_ADAPTER":
      return action.parameters.contractAddress;
  }
}

export function MainnetRescueWorkspace({
  incidentId,
  chainId,
  source,
  destination,
  assetManifest,
}: {
  incidentId: string;
  chainId: number;
  source: EvmAddress;
  destination: EvmAddress;
  assetManifest?: RescueAssetManifest;
}) {
  const chainConfig = getRescueMainnetChainConfig(chainId);
  const [connectedAccount, setConnectedAccount] = useState<`0x${string}`>();
  const [tokenInput, setTokenInput] = useState(
    () => assetManifest?.erc20TokenAddresses.join("\n") ?? "",
  );
  const [nftInput, setNftInput] = useState(
    () => nftAssetInput(assetManifest?.erc721Assets),
  );
  const [erc1155Input, setErc1155Input] = useState(
    () => nftAssetInput(assetManifest?.erc1155Assets),
  );
  const [preflight, setPreflight] = useState<MainnetPreflightResponse>();
  const [authorized, setAuthorized] = useState(false);
  const [selectedRoute, setSelectedRoute] = useState<string>();
  const [signed, setSigned] = useState<SignedRecoveryAuthorization>();
  const [busy, setBusy] = useState<"CONNECT" | "PREFLIGHT" | "SIGN" | "SETTLE" | null>(null);
  const [error, setError] = useState<string>();
  const [transactions, setTransactions] = useState<SubmittedTransaction[]>([]);
  const manifestLocked = Boolean(assetManifest);

  const sourceConnected = connectedAccount?.toLowerCase() === source.toLowerCase();
  const destinationConnected = connectedAccount?.toLowerCase() === destination.toLowerCase();
  const nextGaslessAction =
    preflight?.gaslessActions.find((route) => gaslessRouteKey(route) === selectedRoute) ??
    preflight?.gaslessActions[0];

  async function connectExpected(role: "SOURCE" | "DESTINATION") {
    setBusy("CONNECT");
    setError(undefined);
    try {
      const provider = getOkxProvider();
      await connectOkxWallet(provider);
      await ensureRescueMainnet(provider, chainId);
      const account = await getOkxConnectedAccount(provider);
      setConnectedAccount(account);
      const expected = role === "SOURCE" ? source : destination;
      if (account.toLowerCase() !== expected.toLowerCase()) {
        throw new Error(
          role === "SOURCE"
            ? "Switch OKX Wallet to the reported source account before signing."
            : "Switch OKX Wallet to the safe destination account before settlement.",
        );
      }
    } catch (nextError) {
      setError(errorMessage(nextError));
    } finally {
      setBusy(null);
    }
  }

  async function requestPreflight(): Promise<MainnetPreflightResponse> {
    const response = await fetch(`/api/rescue/${encodeURIComponent(incidentId)}/preflight`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tokenAddresses: tokenAddresses(tokenInput),
        erc721Assets: erc721Assets(nftInput),
        erc1155Assets: erc1155Assets(erc1155Input),
      }),
    });
    const body: unknown = await response.json();
    if (!response.ok) {
      const message =
        body && typeof body === "object" && "message" in body && typeof body.message === "string"
          ? body.message
          : "Mainnet preflight failed";
      throw new Error(message);
    }
    const result = mainnetPreflightResponseSchema.parse(body);
    if (result.chainId !== chainId) {
      throw new Error("Preflight returned a different chain than the incident");
    }
    setPreflight(result);
    setSelectedRoute((current) =>
      result.gaslessActions.some((route) => gaslessRouteKey(route) === current)
        ? current
        : result.gaslessActions[0] ? gaslessRouteKey(result.gaslessActions[0]) : undefined,
    );
    return result;
  }

  async function refreshPreflight() {
    setBusy("PREFLIGHT");
    setError(undefined);
    try {
      setSigned(undefined);
      await requestPreflight();
    } catch (nextError) {
      setError(errorMessage(nextError));
    } finally {
      setBusy(null);
    }
  }

  async function signAuthorization() {
    if (!authorized) {
      setError("Authorization confirmation is required before signing.");
      return;
    }
    setBusy("SIGN");
    setError(undefined);
    try {
      const provider = getOkxProvider();
      await connectOkxWallet(provider);
      await ensureRescueMainnet(provider, chainId);
      const account = await getOkxConnectedAccount(provider);
      setConnectedAccount(account);
      if (account.toLowerCase() !== source.toLowerCase()) {
        throw new Error("Switch OKX Wallet to the reported source account before signing.");
      }

      const intendedRoute = selectedRoute ??
        (nextGaslessAction ? gaslessRouteKey(nextGaslessAction) : undefined);
      if (!intendedRoute) {
        throw new Error("Select a destination-paid recovery route before signing.");
      }
      const fresh = await requestPreflight();
      const action = requireReviewedGaslessRoute(fresh.gaslessActions, intendedRoute);
      const publicClient = createPublicClient({
        chain: chainConfig.chain,
        transport: http(chainConfig.rpcUrls[0]),
      });
      let result: SignedRecoveryAuthorization;
      if (action.standard === "ERC3009_RECEIVE_WITH_AUTHORIZATION") {
        result = await signEip3009Authorization(provider, action, account);
      } else {
        const destinationAccount = getAddress(action.to);
        if (action.standard === "ERC2612_PERMIT_ATOMIC_BATCH") {
          result = await signErc2612Permit(provider, action, account);
          await publicClient.call({
            account: destinationAccount,
            to: result.authorization.tokenAddress,
            data: result.permitData,
          });
        } else if (action.standard === "DAI_PERMIT_ATOMIC_BATCH") {
          result = await signDaiPermitPair(provider, action, account);
          await publicClient.call({
            account: destinationAccount,
            to: result.authorization.tokenAddress,
            data: result.allowPermitData,
          });
        } else {
          result = await signErc4494Permit(provider, action, account);
          await publicClient.call({
            account: destinationAccount,
            to: result.authorization.collectionAddress,
            data: result.permitData,
          });
        }
      }
      setSigned(result);
      setAuthorized(false);
    } catch (nextError) {
      setError(errorMessage(nextError));
    } finally {
      setBusy(null);
    }
  }

  async function settleAuthorization() {
    if (!signed) {
      setError("Sign the source authorization before settlement.");
      return;
    }
    setBusy("SETTLE");
    setError(undefined);
    try {
      const provider = getOkxProvider();
      await connectOkxWallet(provider);
      await ensureRescueMainnet(provider, chainId);
      const account = await getOkxConnectedAccount(provider);
      setConnectedAccount(account);
      if (account.toLowerCase() !== destination.toLowerCase()) {
        throw new Error("Switch OKX Wallet to the safe destination account before settlement.");
      }

      const publicClient = createPublicClient({
        chain: chainConfig.chain,
        transport: http(chainConfig.rpcUrls[0]),
      });
      let hash: Hex;
      if (signed.standard === "ERC3009_RECEIVE_WITH_AUTHORIZATION") {
        await publicClient.call({
          account,
          to: signed.authorization.tokenAddress,
          data: signed.settlementData,
        });
        hash = await submitEip3009Settlement(provider, signed, account);
      } else if (signed.standard === "ERC2612_PERMIT_ATOMIC_BATCH") {
        await publicClient.call({
          account,
          to: signed.authorization.tokenAddress,
          data: signed.permitData,
        });
        const callsId = await submitErc2612AtomicBatch(provider, signed, account);
        let confirmedHash: Hex | undefined;
        for (let attempt = 0; attempt < 60; attempt += 1) {
          const callsStatus = await getOkxCallsStatus(provider, callsId);
          if (callsStatus.status === 200) {
            confirmedHash = callsStatus.transactionHashes[0];
            break;
          }
          if (callsStatus.status === 400 || callsStatus.status === 500) {
            throw new Error("The OKX atomic permit batch failed before confirmation.");
          }
          await new Promise((resolve) => setTimeout(resolve, 2_000));
        }
        if (!confirmedHash) {
          throw new Error("The OKX atomic permit batch did not confirm within two minutes.");
        }
        hash = confirmedHash;
      } else if (signed.standard === "DAI_PERMIT_ATOMIC_BATCH") {
        await publicClient.call({
          account,
          to: signed.authorization.tokenAddress,
          data: signed.allowPermitData,
        });
        const callsId = await submitDaiPermitAtomicBatch(provider, signed, account);
        let confirmedHash: Hex | undefined;
        for (let attempt = 0; attempt < 60; attempt += 1) {
          const callsStatus = await getOkxCallsStatus(provider, callsId);
          if (callsStatus.status === 200) {
            confirmedHash = callsStatus.transactionHashes[0];
            break;
          }
          if (callsStatus.status === 400 || callsStatus.status === 500) {
            throw new Error("The OKX atomic DAI-style permit batch failed before confirmation.");
          }
          await new Promise((resolve) => setTimeout(resolve, 2_000));
        }
        if (!confirmedHash) {
          throw new Error("The OKX atomic DAI-style permit batch did not confirm within two minutes.");
        }
        hash = confirmedHash;
      } else {
        await publicClient.call({
          account,
          to: signed.authorization.collectionAddress,
          data: signed.permitData,
        });
        const callsId = await submitErc4494AtomicBatch(provider, signed, account);
        let confirmedHash: Hex | undefined;
        for (let attempt = 0; attempt < 60; attempt += 1) {
          const callsStatus = await getOkxCallsStatus(provider, callsId);
          if (callsStatus.status === 200) {
            confirmedHash = callsStatus.transactionHashes[0];
            break;
          }
          if (callsStatus.status === 400 || callsStatus.status === 500) {
            throw new Error("The OKX atomic NFT permit batch failed before confirmation.");
          }
          await new Promise((resolve) => setTimeout(resolve, 2_000));
        }
        if (!confirmedHash) {
          throw new Error("The OKX atomic NFT permit batch did not confirm within two minutes.");
        }
        hash = confirmedHash;
      }
      setTransactions((current) => [
        ...current,
        { actionId: signed.authorization.actionId, hash, status: "CONFIRMING" },
      ]);
      const receipt = await publicClient.waitForTransactionReceipt({
        hash,
        confirmations: 1,
        timeout: 120_000,
      });
      const transferProved = receipt.status === "success" &&
        receiptProvesCommittedTransfer(signed, receipt.logs);
      const status = transferProved ? "CONFIRMED" : "FAILED";
      setTransactions((current) =>
        current.map((item) => (item.hash === hash ? { ...item, status } : item)),
      );
      if (receipt.status !== "success") {
        throw new Error("The destination-paid settlement was included but reverted.");
      }
      if (!transferProved) {
        throw new Error(
          "The confirmed receipt does not prove the exact committed asset transfer.",
        );
      }
      setSigned(undefined);
      await requestPreflight();
    } catch (nextError) {
      setError(errorMessage(nextError));
    } finally {
      setBusy(null);
    }
  }

  return (
    <main>
      <section className="border-b border-border bg-surface">
        <div className="content-shell py-8 sm:py-10">
          <Link href="/" className="mb-6 inline-flex items-center gap-2 text-xs text-muted hover:text-foreground">
            <ArrowLeft className="size-3.5" /> Start rescue
          </Link>
          <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="mb-4 flex flex-wrap items-center gap-2">
                <Badge variant="danger">User reported compromised</Badge>
                <Badge variant="success">Source pays 0 gas</Badge>
                <Badge variant="danger">Real funds</Badge>
              </div>
              <p className="font-mono text-[10px] uppercase text-dim">Incident {incidentId}</p>
              <h1 className="mt-2 text-3xl font-semibold">Destination-paid rescue</h1>
            </div>
            <Badge variant="info">{chainConfig.chain.name} / {chainId}</Badge>
          </div>
        </div>
      </section>

      <section className="border-b border-border">
        <div className="content-shell grid py-6 md:grid-cols-2">
          <div className="min-w-0 border-b border-border pb-5 md:border-b-0 md:border-r md:pb-0 md:pr-6">
            <div className="mb-2 flex items-center gap-2"><ShieldAlert className="size-3.5 text-danger" /><span className="font-mono text-[10px] uppercase text-dim">Source signs only</span></div>
            <CopyAddress address={source} />
          </div>
          <div className="min-w-0 pt-5 md:pl-6 md:pt-0">
            <div className="mb-2 flex items-center gap-2"><ShieldCheck className="size-3.5 text-accent" /><span className="font-mono text-[10px] uppercase text-dim">Destination pays network fee</span></div>
            <CopyAddress address={destination} />
          </div>
        </div>
      </section>

      <section className="content-shell py-10 sm:py-14">
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_380px]">
          <div className="space-y-10">
            <section>
              <div className="border-b border-border pb-4">
                <p className="font-mono text-[10px] uppercase text-info">01 / Deterministic scan</p>
                <h2 className="mt-2 text-xl font-semibold">Verify destination-paid asset paths</h2>
              </div>
              <label className="mt-5 block">
                <span className="mb-2 block text-sm font-semibold">Known ERC-20 contracts</span>
                <textarea
                  value={tokenInput}
                  onChange={(event) => setTokenInput(event.target.value)}
                  readOnly={manifestLocked}
                  rows={3}
                  placeholder="0x... one address per line"
                  spellCheck={false}
                  className="w-full resize-y rounded-md border border-border-strong bg-background p-3 font-mono text-sm text-foreground placeholder:text-dim focus:border-accent focus:outline focus:outline-1"
                />
                <span className="mt-2 block text-xs leading-5 text-muted">Every submitted contract is verified independently at the same pinned block before authorization is enabled.</span>
              </label>
              <label className="mt-5 block">
                <span className="mb-2 block text-sm font-semibold">Known ERC-721 assets</span>
                <textarea
                  value={nftInput}
                  onChange={(event) => setNftInput(event.target.value)}
                  readOnly={manifestLocked}
                  rows={3}
                  placeholder="0xCollection:tokenId one per line"
                  spellCheck={false}
                  className="w-full resize-y rounded-md border border-border-strong bg-background p-3 font-mono text-sm text-foreground placeholder:text-dim focus:border-accent focus:outline focus:outline-1"
                />
                <span className="mt-2 block text-xs leading-5 text-muted">Only explicitly listed token IDs are checked. ERC-4494 support and ownership are verified onchain before signing.</span>
              </label>
              <label className="mt-5 block">
                <span className="mb-2 block text-sm font-semibold">Known ERC-1155 assets</span>
                <textarea
                  value={erc1155Input}
                  onChange={(event) => setErc1155Input(event.target.value)}
                  readOnly={manifestLocked}
                  rows={3}
                  placeholder="0xCollection:tokenId one per line"
                  spellCheck={false}
                  className="w-full resize-y rounded-md border border-border-strong bg-background p-3 font-mono text-sm text-foreground placeholder:text-dim focus:border-accent focus:outline focus:outline-1"
                />
                <span className="mt-2 block text-xs leading-5 text-muted">ERC-1155 balances are verified onchain. Assets remain blocked unless a destination-paid recovery adapter is available.</span>
              </label>
              {manifestLocked && (
                <p className="mt-4 text-xs leading-5 text-info">
                  This batch is committed to the incident. Start a new incident to change its asset contracts.
                </p>
              )}
              <Button type="button" className="mt-4" variant="secondary" onClick={() => void refreshPreflight()} disabled={busy !== null}>
                {busy === "PREFLIGHT" ? <LoaderCircle className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
                Run fresh preflight
              </Button>
            </section>

            <section>
              <div className="border-b border-border pb-4">
                <p className="font-mono text-[10px] uppercase text-info">02 / Rescue plan</p>
                <h2 className="mt-2 text-xl font-semibold">Destination-paid eligibility</h2>
              </div>
              {!preflight ? (
                <p className="mt-5 text-sm text-muted">Run preflight to read current mainnet state and verify token capabilities.</p>
              ) : preflight.plan.actions.length === 0 ? (
                <p className="mt-5 text-sm text-muted">No positive supported balances were detected for the current manifest.</p>
              ) : (
                <div className="mt-5 divide-y divide-border border-y border-border">
                  {preflight.plan.actions.map((action, index) => {
                    const gasless = preflight.gaslessActions.find((item) => item.actionId === action.id);
                    const blocked = preflight.blockedActions.find((item) => item.actionId === action.id);
                    const simulation = preflight.simulations.find((item) => item.actionId === action.id);
                    return (
                      <div key={action.id} className="grid gap-3 py-4 sm:grid-cols-[40px_1fr_auto] sm:items-start">
                        <span className="font-mono text-xs text-dim">{String(index + 1).padStart(2, "0")}</span>
                        <div className="min-w-0">
                          <p className="text-sm font-semibold capitalize">{actionLabel(action.actionType)}</p>
                          <div className="mt-1"><CopyAddress address={actionTarget(action)} compact /></div>
                          <p className="mt-2 text-xs leading-5 text-muted">{gasless ? `${preflight.gaslessActions.filter((item) => item.actionId === action.id).length} destination-paid route(s) detected. Source signature is offchain; destination submits.` : blocked?.reason}</p>
                          <code className="mt-1 block truncate font-mono text-[11px] text-dim">State preflight: {simulation?.status ?? "NOT RUN"}</code>
                        </div>
                        <Badge variant={gasless ? "success" : "danger"}>{gasless ? "AUTHORIZATION READY" : "BLOCKED"}</Badge>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            <section>
              <div className="border-b border-border pb-4">
                <p className="font-mono text-[10px] uppercase text-info">03 / Sequential account handoff</p>
                <h2 className="mt-2 text-xl font-semibold">One active OKX account at a time</h2>
              </div>
              <div className="mt-5 grid gap-5 sm:grid-cols-2">
                <div className="border-l-2 border-info bg-info/5 p-4">
                  <div className="flex items-center justify-between gap-3"><span className="text-sm font-semibold">1. Source account</span><Badge variant={signed ? "success" : sourceConnected ? "info" : "neutral"}>{signed ? "SIGNED" : sourceConnected ? "ACTIVE" : "STEP 1"}</Badge></div>
                  <p className="mt-3 text-xs leading-5 text-muted">Make the source active in OKX Wallet and sign typed data. It does not remain connected and pays no gas.</p>
                  <Button type="button" className="mt-4 w-full" variant="secondary" onClick={() => void connectExpected("SOURCE")} disabled={Boolean(signed) || busy !== null}>
                    <Wallet className="size-4" /> Use source account
                  </Button>
                </div>
                <div className="border-l-2 border-accent bg-accent/5 p-4">
                  <div className="flex items-center justify-between gap-3"><span className="text-sm font-semibold">2. Safe destination</span><Badge variant={destinationConnected ? "success" : signed ? "info" : "neutral"}>{destinationConnected ? "ACTIVE" : signed ? "SWITCH NOW" : "AFTER SIGN"}</Badge></div>
                  <p className="mt-3 text-xs leading-5 text-muted">After signing, switch the active OKX account to the destination. Keep this tab open so the authorization stays in memory.</p>
                  <Button type="button" className="mt-4 w-full" variant="secondary" onClick={() => void connectExpected("DESTINATION")} disabled={!signed || busy !== null}>
                    <Wallet className="size-4" /> Check destination account
                  </Button>
                </div>
              </div>
              {preflight && preflight.gaslessActions.length > 0 && (
                <div className="mt-5">
                  <p className="mb-2 font-mono text-[10px] uppercase text-dim">Recovery route</p>
                  <div className="grid gap-2">
                    {preflight.gaslessActions.map((route) => (
                      <button
                        key={`${route.actionId}:${route.standard}`}
                        type="button"
                        onClick={() => {
                          setSelectedRoute(gaslessRouteKey(route));
                          setSigned(undefined);
                        }}
                        className={`flex items-center justify-between gap-4 border px-3 py-3 text-left text-sm ${nextGaslessAction && gaslessRouteKey(nextGaslessAction) === gaslessRouteKey(route) ? "border-accent bg-accent/5" : "border-border bg-background"}`}
                      >
                        <span>{routeLabel(route.standard)}</span>
                        <Badge variant={route.capabilityStatus === "VERIFIED" ? "success" : "info"}>
                          {route.capabilityStatus === "VERIFIED" ? "VERIFIED" : "VERIFY ON SIGN"}
                        </Badge>
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
                <span className="text-muted">Current OKX account</span>
                {connectedAccount ? <CopyAddress address={connectedAccount} compact /> : <Badge variant="neutral">Not connected</Badge>}
              </div>
            </section>

            {transactions.length > 0 && (
              <section>
                <div className="border-b border-border pb-4"><p className="font-mono text-[10px] uppercase text-accent">Execution status</p><h2 className="mt-2 text-xl font-semibold">Destination-paid settlements</h2></div>
                <div className="mt-5 space-y-4">
                  {transactions.map((transaction) => (
                    <div key={transaction.hash} className="border-l-2 border-border-strong pl-4">
                      <Badge variant={transaction.status === "CONFIRMED" ? "success" : transaction.status === "FAILED" ? "danger" : "info"}>{transaction.status}</Badge>
                      {chainConfig.chain.blockExplorers?.default && (
                        <a href={`${chainConfig.chain.blockExplorers.default.url}/tx/${transaction.hash}`} target="_blank" rel="noreferrer" className="mt-2 inline-flex max-w-full items-center gap-2 font-mono text-[11px] text-info hover:text-foreground"><span className="break-all">{transaction.hash}</span><ExternalLink className="size-3.5 shrink-0" /></a>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>

          <aside className="self-start border-l-2 border-warning bg-warning/5 p-5 lg:sticky lg:top-6">
            <p className="font-mono text-[10px] uppercase text-warning">Authorization checkpoint</p>
            <h2 className="mt-2 text-lg font-semibold">Source-funded execution disabled</h2>
            <div className="mt-5 space-y-4 border-y border-border py-4 text-xs">
              <div className="flex justify-between gap-4"><span className="text-muted">Network</span><span>{chainConfig.chain.name}</span></div>
              <div className="space-y-2"><span className="block text-muted">Source signs</span><CopyAddress address={source} compact /></div>
              <div className="space-y-2"><span className="block text-muted">Destination receives and pays gas</span><CopyAddress address={destination} compact /></div>
              <div className="flex justify-between gap-4"><span className="text-muted">Route</span><span className="text-right">{nextGaslessAction ? routeLabel(nextGaslessAction.standard) : "None verified"}</span></div>
              {nextGaslessAction && <div className="space-y-2"><span className="block text-muted">Asset contract</span><CopyAddress address={routeContract(nextGaslessAction)} compact /></div>}
              {nextGaslessAction?.standard === "ERC4494_PERMIT_ATOMIC_BATCH" && <div className="flex justify-between gap-4"><span className="text-muted">Token ID</span><span className="font-mono">{nextGaslessAction.tokenId}</span></div>}
              {nextGaslessAction?.standard === "DAI_PERMIT_ATOMIC_BATCH" && <div className="flex justify-between gap-4"><span className="text-muted">Source signatures</span><span className="font-mono">2 (allow + revoke)</span></div>}
              <div className="flex justify-between gap-4"><span className="text-muted">Authorization</span><Badge variant={signed ? "success" : "neutral"}>{signed ? "SIGNED IN MEMORY" : "NOT SIGNED"}</Badge></div>
              <div className="flex justify-between gap-4"><span className="text-muted">Preflight block</span><span className="font-mono">{preflight?.scan.observedAtBlock ?? "--"}</span></div>
            </div>

            {!signed ? (
              <>
                <label className="mt-5 flex cursor-pointer items-start gap-3">
                  <Checkbox checked={authorized} onChange={(event) => setAuthorized(event.target.checked)} />
                  <span className="text-xs leading-5">I confirm I am authorised to control and sign for the displayed source wallet, and I understand this action uses {chainConfig.chain.name} with real assets.</span>
                </label>
                <Button type="button" className="mt-5 w-full" size="lg" onClick={() => void signAuthorization()} disabled={!sourceConnected || !nextGaslessAction || !authorized || busy !== null}>
                  {busy === "SIGN" ? <LoaderCircle className="size-4 animate-spin" /> : <FileSignature className="size-4" />}
                  Sign gasless authorization
                </Button>
              </>
            ) : (
              <>
                <p className="mt-5 flex items-start gap-2 text-xs leading-5 text-accent"><ShieldCheck className="mt-0.5 size-3.5 shrink-0" />Authorization signed locally. Without refreshing this page, switch OKX Wallet to the displayed destination account.</p>
                <Button type="button" className="mt-5 w-full" size="lg" onClick={() => void settleAuthorization()} disabled={busy !== null}>
                  {busy === "SETTLE" ? <LoaderCircle className="size-4 animate-spin" /> : <Send className="size-4" />}
                  Check destination and settle
                </Button>
              </>
            )}
            <p className="mt-4 text-xs leading-5 text-muted">This action moves real assets. The authorization is short-lived and stays in this browser tab. SAFEEXIT never receives the private key, seed phrase, or signature.</p>
            {preflight?.blockedActions.some((item) => preflight.plan.actions.find((action) => action.id === item.actionId)?.actionType === "TRANSFER_NATIVE") && (
              <p className="mt-4 flex items-start gap-2 text-xs leading-5 text-warning"><TriangleAlert className="mt-0.5 size-3.5 shrink-0" />Native {chainConfig.chain.nativeCurrency.symbol} is blocked until a verified sponsored EIP-7702 or private atomic bundle adapter is available.</p>
            )}
            {error && <p role="alert" className="mt-4 flex items-start gap-2 text-xs leading-5 text-danger"><TriangleAlert className="mt-0.5 size-3.5 shrink-0" />{error}</p>}
          </aside>
        </div>
      </section>
    </main>
  );
}
