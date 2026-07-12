"use client";

import Link from "next/link";
import {
  ArrowLeft,
  ExternalLink,
  LoaderCircle,
  RefreshCw,
  Send,
  ShieldAlert,
  ShieldCheck,
  TriangleAlert,
  Wallet,
} from "lucide-react";
import { useState } from "react";
import { createPublicClient, http, isAddress, type Hex } from "viem";

import { prepareWalletTransaction } from "@safeexit/execution";
import { xLayerTestnetConfig } from "@safeexit/chain";
import type { EvmAddress, RescueAction } from "@safeexit/shared";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { CopyAddress } from "@/components/copy-address";
import {
  connectOkxWallet,
  ensureXLayerTestnet,
  getOkxProvider,
  sendPreparedTestnetTransaction,
} from "@/lib/okx-wallet";
import {
  testnetPreflightResponseSchema,
  type TestnetPreflightResponse,
} from "@/lib/testnet-rescue";

type SubmittedTransaction = {
  actionId: string;
  actionType: RescueAction["actionType"];
  hash: Hex;
  status: "CONFIRMING" | "CONFIRMED" | "FAILED";
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "The testnet operation failed";
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

function actionLabel(actionType: string): string {
  return actionType.toLowerCase().replaceAll("_", " ");
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

export function TestnetRescueWorkspace({
  incidentId,
  source,
  destination,
}: {
  incidentId: string;
  source: EvmAddress;
  destination: EvmAddress;
}) {
  const [connectedAccount, setConnectedAccount] = useState<`0x${string}`>();
  const [tokenInput, setTokenInput] = useState("");
  const [preflight, setPreflight] = useState<TestnetPreflightResponse>();
  const [authorized, setAuthorized] = useState(false);
  const [busy, setBusy] = useState<"CONNECT" | "PREFLIGHT" | "SIGN" | null>(null);
  const [error, setError] = useState<string>();
  const [transactions, setTransactions] = useState<SubmittedTransaction[]>([]);

  const accountMatches =
    connectedAccount?.toLowerCase() === source.toLowerCase();
  const nextAction = preflight?.plan.actions.find((action) =>
    preflight.executableActionIds.includes(action.id),
  );

  async function connect() {
    setBusy("CONNECT");
    setError(undefined);
    try {
      const provider = getOkxProvider();
      const account = await connectOkxWallet(provider);
      await ensureXLayerTestnet(provider);
      setConnectedAccount(account);
      if (account.toLowerCase() !== source.toLowerCase()) {
        setError("Connected OKX Wallet account does not match the reported source wallet.");
      }
    } catch (nextError) {
      setError(errorMessage(nextError));
    } finally {
      setBusy(null);
    }
  }

  async function requestPreflight(): Promise<TestnetPreflightResponse> {
    const response = await fetch(`/api/rescue/${encodeURIComponent(incidentId)}/preflight`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tokenAddresses: tokenAddresses(tokenInput) }),
    });
    const body: unknown = await response.json();
    if (!response.ok) {
      const message =
        body && typeof body === "object" && "message" in body && typeof body.message === "string"
          ? body.message
          : "Testnet preflight failed";
      throw new Error(message);
    }
    const result = testnetPreflightResponseSchema.parse(body);
    setPreflight(result);
    return result;
  }

  async function refreshPreflight() {
    setBusy("PREFLIGHT");
    setError(undefined);
    try {
      await requestPreflight();
    } catch (nextError) {
      setError(errorMessage(nextError));
    } finally {
      setBusy(null);
    }
  }

  async function signNextAction() {
    if (!authorized) {
      setError("Authorisation confirmation is required before every signing session.");
      return;
    }
    setBusy("SIGN");
    setError(undefined);
    try {
      const provider = getOkxProvider();
      const account = await connectOkxWallet(provider);
      await ensureXLayerTestnet(provider);
      if (account.toLowerCase() !== source.toLowerCase()) {
        throw new Error("Connected OKX Wallet account does not match the reported source wallet");
      }

      const fresh = await requestPreflight();
      const action = fresh.plan.actions.find((candidate) =>
        fresh.executableActionIds.includes(candidate.id),
      );
      if (!action) {
        throw new Error("No action has a fresh successful preflight");
      }
      const simulation = fresh.simulations.find((result) => result.actionId === action.id);
      if (!simulation) {
        throw new Error("The next action has no matching preflight result");
      }
      const transaction = prepareWalletTransaction(fresh.plan, simulation, new Date());
      const hash = await sendPreparedTestnetTransaction(provider, transaction, account);
      setTransactions((current) => [
        ...current,
        { actionId: action.id, actionType: action.actionType, hash, status: "CONFIRMING" },
      ]);

      const receipt = await createPublicClient({
        chain: xLayerTestnetConfig.chain,
        transport: http(xLayerTestnetConfig.rpcUrls[0]),
      }).waitForTransactionReceipt({ hash, confirmations: 1, timeout: 120_000 });
      const status = receipt.status === "success" ? "CONFIRMED" : "FAILED";
      setTransactions((current) =>
        current.map((item) => (item.hash === hash ? { ...item, status } : item)),
      );
      if (status === "FAILED") {
        throw new Error("The testnet transaction was included but reverted");
      }
      await requestPreflight();
      setAuthorized(false);
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
                <Badge variant="info">Testnet signing pilot</Badge>
              </div>
              <p className="font-mono text-[10px] uppercase text-dim">Incident {incidentId}</p>
              <h1 className="mt-2 text-3xl font-semibold">X Layer rescue execution</h1>
            </div>
            <Badge variant="info">X Layer testnet / 1952</Badge>
          </div>
        </div>
      </section>

      <section className="border-b border-border">
        <div className="content-shell grid py-6 md:grid-cols-2">
          <div className="min-w-0 border-b border-border pb-5 md:border-b-0 md:border-r md:pb-0 md:pr-6">
            <div className="mb-2 flex items-center gap-2"><ShieldAlert className="size-3.5 text-danger" /><span className="font-mono text-[10px] uppercase text-dim">Source</span></div>
            <CopyAddress address={source} />
          </div>
          <div className="min-w-0 pt-5 md:pl-6 md:pt-0">
            <div className="mb-2 flex items-center gap-2"><ShieldCheck className="size-3.5 text-accent" /><span className="font-mono text-[10px] uppercase text-dim">Safe destination</span></div>
            <CopyAddress address={destination} />
          </div>
        </div>
      </section>

      <section className="content-shell py-10 sm:py-14">
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="space-y-10">
            <section>
              <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border pb-4">
                <div><p className="font-mono text-[10px] uppercase text-info">01 / Wallet</p><h2 className="mt-2 text-xl font-semibold">Connect the reported source</h2></div>
                <Button type="button" variant="secondary" onClick={() => void connect()} disabled={busy !== null}>
                  {busy === "CONNECT" ? <LoaderCircle className="size-4 animate-spin" /> : <Wallet className="size-4" />}
                  {connectedAccount ? "Reconnect OKX Wallet" : "Connect OKX Wallet"}
                </Button>
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
                <span className="text-muted">Connected account</span>
                {connectedAccount ? <CopyAddress address={connectedAccount} compact /> : <Badge variant="neutral">Not connected</Badge>}
                {connectedAccount && <Badge variant={accountMatches ? "success" : "danger"}>{accountMatches ? "Source matched" : "Wrong account"}</Badge>}
              </div>
            </section>

            <section>
              <div className="border-b border-border pb-4"><p className="font-mono text-[10px] uppercase text-info">02 / Deterministic scan</p><h2 className="mt-2 text-xl font-semibold">Add known testnet ERC-20 contracts</h2></div>
              <label className="mt-5 block">
                <span className="mb-2 block text-sm font-semibold">Contract manifest</span>
                <textarea
                  value={tokenInput}
                  onChange={(event) => setTokenInput(event.target.value)}
                  rows={4}
                  placeholder="0x... one address per line"
                  spellCheck={false}
                  className="w-full resize-y rounded-md border border-border-strong bg-background p-3 font-mono text-sm text-foreground placeholder:text-dim focus:border-accent focus:outline focus:outline-1"
                />
                <span className="mt-2 block text-xs leading-5 text-muted">Native balance is always checked. Token discovery is limited to these addresses and never treated as exhaustive.</span>
              </label>
              <Button type="button" className="mt-4" variant="secondary" onClick={() => void refreshPreflight()} disabled={busy !== null}>
                {busy === "PREFLIGHT" ? <LoaderCircle className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
                Run fresh preflight
              </Button>
            </section>

            <section>
              <div className="border-b border-border pb-4"><p className="font-mono text-[10px] uppercase text-info">03 / Plan and simulation</p><h2 className="mt-2 text-xl font-semibold">Integrity-locked actions</h2></div>
              {!preflight ? (
                <p className="mt-5 text-sm text-muted">Run preflight to read current testnet state and create a plan.</p>
              ) : preflight.plan.actions.length === 0 ? (
                <p className="mt-5 text-sm text-muted">No supported positive balances were detected in the current manifest.</p>
              ) : (
                <div className="mt-5 divide-y divide-border border-y border-border">
                  {preflight.plan.actions.map((action, index) => {
                    const result = preflight.simulations.find((item) => item.actionId === action.id);
                    return (
                      <div key={action.id} className="grid gap-3 py-4 sm:grid-cols-[40px_1fr_auto] sm:items-center">
                        <span className="font-mono text-xs text-dim">{String(index + 1).padStart(2, "0")}</span>
                        <div className="min-w-0"><p className="text-sm font-semibold capitalize">{actionLabel(action.actionType)}</p><div className="mt-1"><CopyAddress address={actionTarget(action)} compact /></div><code className="mt-1 block truncate font-mono text-[11px] text-muted">{action.id}</code></div>
                        <Badge variant={result?.status === "SUCCEEDED" ? "success" : "danger"}>{result?.status ?? "NOT SIMULATED"}</Badge>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            {transactions.length > 0 && (
              <section>
                <div className="border-b border-border pb-4"><p className="font-mono text-[10px] uppercase text-accent">Execution status</p><h2 className="mt-2 text-xl font-semibold">Submitted testnet transactions</h2></div>
                <div className="mt-5 space-y-4">
                  {transactions.map((transaction) => (
                    <div key={transaction.hash} className="border-l-2 border-border-strong pl-4">
                      <div className="flex flex-wrap items-center gap-3"><Badge variant={transaction.status === "CONFIRMED" ? "success" : transaction.status === "FAILED" ? "danger" : "info"}>{transaction.status}</Badge><span className="text-xs capitalize text-muted">{actionLabel(transaction.actionType)}</span></div>
                      <a href={`https://www.okx.com/web3/explorer/xlayer-test/tx/${transaction.hash}`} target="_blank" rel="noreferrer" className="mt-2 inline-flex max-w-full items-center gap-2 font-mono text-[11px] text-info hover:text-foreground"><span className="break-all">{transaction.hash}</span><ExternalLink className="size-3.5 shrink-0" /></a>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>

          <aside className="self-start border-l-2 border-warning bg-warning/5 p-5 lg:sticky lg:top-6">
            <p className="font-mono text-[10px] uppercase text-warning">Signing checkpoint</p>
            <h2 className="mt-2 text-lg font-semibold">Review the next action</h2>
            <div className="mt-5 space-y-4 border-y border-border py-4 text-xs">
              <div className="flex justify-between gap-4"><span className="text-muted">Network</span><span>X Layer testnet</span></div>
              <div className="space-y-2"><span className="block text-muted">Source</span><CopyAddress address={source} compact /></div>
              <div className="space-y-2"><span className="block text-muted">Safe destination</span><CopyAddress address={destination} compact /></div>
              <div className="flex justify-between gap-4"><span className="text-muted">Next action</span><span className="text-right capitalize">{nextAction ? actionLabel(nextAction.actionType) : "None"}</span></div>
              {nextAction && <div className="space-y-2"><span className="block text-muted">Contract or recipient</span><CopyAddress address={actionTarget(nextAction)} compact /></div>}
              <div className="flex justify-between gap-4"><span className="text-muted">Preflight block</span><span className="font-mono">{preflight?.scan.observedAtBlock ?? "--"}</span></div>
              <div className="flex justify-between gap-4"><span className="text-muted">Detected assets</span><span>{preflight?.scan.assets.length ?? 0}</span></div>
            </div>
            {nextAction?.actionType === "TRANSFER_NATIVE" && (
              <p className="mt-4 flex items-start gap-2 text-xs leading-5 text-warning"><TriangleAlert className="mt-0.5 size-3.5 shrink-0" />This action transfers the simulated maximum native balance after reserving estimated gas.</p>
            )}
            <label className="mt-5 flex cursor-pointer items-start gap-3">
              <Checkbox checked={authorized} onChange={(event) => setAuthorized(event.target.checked)} />
              <span className="text-xs leading-5">I confirm I am authorised to sign for the displayed source and approve only the reviewed testnet action.</span>
            </label>
            <Button type="button" className="mt-5 w-full" size="lg" onClick={() => void signNextAction()} disabled={!accountMatches || !nextAction || !authorized || busy !== null}>
              {busy === "SIGN" ? <LoaderCircle className="size-4 animate-spin" /> : <Send className="size-4" />}
              Sign next testnet action
            </Button>
            <p className="mt-4 text-xs leading-5 text-muted">A fresh preflight runs immediately before the OKX Wallet popup. SAFEEXIT never receives the private key, seed phrase, or raw signature.</p>
            {error && <p role="alert" className="mt-4 flex items-start gap-2 text-xs leading-5 text-danger"><TriangleAlert className="mt-0.5 size-3.5 shrink-0" />{error}</p>}
          </aside>
        </div>
      </section>
    </main>
  );
}
