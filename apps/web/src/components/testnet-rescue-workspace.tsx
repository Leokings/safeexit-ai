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
import { createPublicClient, http, isAddress, type Hex } from "viem";

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
  signEip3009Authorization,
  submitEip3009Settlement,
  type SignedEip3009Authorization,
} from "@/lib/okx-wallet";
import {
  testnetPreflightResponseSchema,
  type TestnetPreflightResponse,
} from "@/lib/testnet-rescue";

const OFFICIAL_TEST_USDT0 = "0x9e29b3aada05bf2d2c827af80bd28dc0b9b4fb0c";

type SubmittedTransaction = {
  actionId: string;
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
  const [tokenInput, setTokenInput] = useState(OFFICIAL_TEST_USDT0);
  const [preflight, setPreflight] = useState<TestnetPreflightResponse>();
  const [authorized, setAuthorized] = useState(false);
  const [signed, setSigned] = useState<SignedEip3009Authorization>();
  const [busy, setBusy] = useState<"CONNECT" | "PREFLIGHT" | "SIGN" | "SETTLE" | null>(null);
  const [error, setError] = useState<string>();
  const [transactions, setTransactions] = useState<SubmittedTransaction[]>([]);

  const sourceConnected = connectedAccount?.toLowerCase() === source.toLowerCase();
  const destinationConnected = connectedAccount?.toLowerCase() === destination.toLowerCase();
  const nextGaslessAction = preflight?.gaslessActions[0];

  async function connectExpected(role: "SOURCE" | "DESTINATION") {
    setBusy("CONNECT");
    setError(undefined);
    try {
      const provider = getOkxProvider();
      const account = await connectOkxWallet(provider);
      await ensureXLayerTestnet(provider);
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
      const account = await connectOkxWallet(provider);
      await ensureXLayerTestnet(provider);
      setConnectedAccount(account);
      if (account.toLowerCase() !== source.toLowerCase()) {
        throw new Error("Switch OKX Wallet to the reported source account before signing.");
      }

      const fresh = await requestPreflight();
      const action = fresh.gaslessActions[0];
      if (!action) {
        throw new Error("No verified destination-paid ERC-3009 action is available.");
      }
      const result = await signEip3009Authorization(provider, action, account);
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
      const account = await connectOkxWallet(provider);
      await ensureXLayerTestnet(provider);
      setConnectedAccount(account);
      if (account.toLowerCase() !== destination.toLowerCase()) {
        throw new Error("Switch OKX Wallet to the safe destination account before settlement.");
      }

      const publicClient = createPublicClient({
        chain: xLayerTestnetConfig.chain,
        transport: http(xLayerTestnetConfig.rpcUrls[0]),
      });
      await publicClient.call({
        account,
        to: signed.authorization.tokenAddress,
        data: signed.settlementData,
      });

      const hash = await submitEip3009Settlement(provider, signed, account);
      setTransactions((current) => [
        ...current,
        { actionId: signed.authorization.actionId, hash, status: "CONFIRMING" },
      ]);
      const receipt = await publicClient.waitForTransactionReceipt({
        hash,
        confirmations: 1,
        timeout: 120_000,
      });
      const status = receipt.status === "success" ? "CONFIRMED" : "FAILED";
      setTransactions((current) =>
        current.map((item) => (item.hash === hash ? { ...item, status } : item)),
      );
      if (status === "FAILED") {
        throw new Error("The destination-paid settlement was included but reverted.");
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
                <Badge variant="info">Testnet pilot</Badge>
              </div>
              <p className="font-mono text-[10px] uppercase text-dim">Incident {incidentId}</p>
              <h1 className="mt-2 text-3xl font-semibold">Destination-paid rescue</h1>
            </div>
            <Badge variant="info">X Layer testnet / 1952</Badge>
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
                <h2 className="mt-2 text-xl font-semibold">Verify a gasless token path</h2>
              </div>
              <label className="mt-5 block">
                <span className="mb-2 block text-sm font-semibold">Known ERC-20 contracts</span>
                <textarea
                  value={tokenInput}
                  onChange={(event) => setTokenInput(event.target.value)}
                  rows={3}
                  placeholder="0x... one address per line"
                  spellCheck={false}
                  className="w-full resize-y rounded-md border border-border-strong bg-background p-3 font-mono text-sm text-foreground placeholder:text-dim focus:border-accent focus:outline focus:outline-1"
                />
                <span className="mt-2 block text-xs leading-5 text-muted">Pre-filled with official X Layer testnet USD₮0. SAFEEXIT verifies its ERC-3009 domain onchain before enabling authorization.</span>
              </label>
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
                <p className="mt-5 text-sm text-muted">Run preflight to read current testnet state and verify token capabilities.</p>
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
                          <p className="mt-2 text-xs leading-5 text-muted">{gasless ? "Verified ERC-3009 authorization. Source signature is offchain; destination submits." : blocked?.reason}</p>
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
                <p className="font-mono text-[10px] uppercase text-info">03 / Two-wallet execution</p>
                <h2 className="mt-2 text-xl font-semibold">Sign from source, settle from destination</h2>
              </div>
              <div className="mt-5 grid gap-5 sm:grid-cols-2">
                <div className="border-l-2 border-info bg-info/5 p-4">
                  <div className="flex items-center justify-between gap-3"><span className="text-sm font-semibold">Source account</span><Badge variant={sourceConnected ? "success" : "neutral"}>{sourceConnected ? "MATCHED" : "SIGNER"}</Badge></div>
                  <p className="mt-3 text-xs leading-5 text-muted">Signs typed data only. No transaction or gas payment is requested from this wallet.</p>
                  <Button type="button" className="mt-4 w-full" variant="secondary" onClick={() => void connectExpected("SOURCE")} disabled={busy !== null}>
                    <Wallet className="size-4" /> Connect source
                  </Button>
                </div>
                <div className="border-l-2 border-accent bg-accent/5 p-4">
                  <div className="flex items-center justify-between gap-3"><span className="text-sm font-semibold">Safe destination</span><Badge variant={destinationConnected ? "success" : "neutral"}>{destinationConnected ? "MATCHED" : "RELAYER"}</Badge></div>
                  <p className="mt-3 text-xs leading-5 text-muted">Submits the signed authorization and pays X Layer network gas after exact-call simulation.</p>
                  <Button type="button" className="mt-4 w-full" variant="secondary" onClick={() => void connectExpected("DESTINATION")} disabled={busy !== null}>
                    <Wallet className="size-4" /> Connect destination
                  </Button>
                </div>
              </div>
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
                      <a href={`https://www.okx.com/web3/explorer/xlayer-test/tx/${transaction.hash}`} target="_blank" rel="noreferrer" className="mt-2 inline-flex max-w-full items-center gap-2 font-mono text-[11px] text-info hover:text-foreground"><span className="break-all">{transaction.hash}</span><ExternalLink className="size-3.5 shrink-0" /></a>
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
              <div className="flex justify-between gap-4"><span className="text-muted">Network</span><span>X Layer testnet</span></div>
              <div className="space-y-2"><span className="block text-muted">Source signs</span><CopyAddress address={source} compact /></div>
              <div className="space-y-2"><span className="block text-muted">Destination receives and pays gas</span><CopyAddress address={destination} compact /></div>
              <div className="flex justify-between gap-4"><span className="text-muted">Standard</span><span className="text-right">{nextGaslessAction ? "ERC-3009" : "None verified"}</span></div>
              {nextGaslessAction && <div className="space-y-2"><span className="block text-muted">Token contract</span><CopyAddress address={nextGaslessAction.tokenAddress} compact /></div>}
              <div className="flex justify-between gap-4"><span className="text-muted">Authorization</span><Badge variant={signed ? "success" : "neutral"}>{signed ? "SIGNED IN MEMORY" : "NOT SIGNED"}</Badge></div>
              <div className="flex justify-between gap-4"><span className="text-muted">Preflight block</span><span className="font-mono">{preflight?.scan.observedAtBlock ?? "--"}</span></div>
            </div>

            {!signed ? (
              <>
                <label className="mt-5 flex cursor-pointer items-start gap-3">
                  <Checkbox checked={authorized} onChange={(event) => setAuthorized(event.target.checked)} />
                  <span className="text-xs leading-5">I confirm I am authorised to control and sign for the displayed source wallet.</span>
                </label>
                <Button type="button" className="mt-5 w-full" size="lg" onClick={() => void signAuthorization()} disabled={!sourceConnected || !nextGaslessAction || !authorized || busy !== null}>
                  {busy === "SIGN" ? <LoaderCircle className="size-4 animate-spin" /> : <FileSignature className="size-4" />}
                  Sign gasless authorization
                </Button>
              </>
            ) : (
              <>
                <p className="mt-5 flex items-start gap-2 text-xs leading-5 text-accent"><ShieldCheck className="mt-0.5 size-3.5 shrink-0" />Authorization signed locally. Switch OKX Wallet to the displayed destination account.</p>
                <Button type="button" className="mt-5 w-full" size="lg" onClick={() => void settleAuthorization()} disabled={!destinationConnected || busy !== null}>
                  {busy === "SETTLE" ? <LoaderCircle className="size-4 animate-spin" /> : <Send className="size-4" />}
                  Settle from destination
                </Button>
              </>
            )}
            <p className="mt-4 text-xs leading-5 text-muted">The authorization is short-lived and stays in this browser tab. SAFEEXIT never receives the private key, seed phrase, or signature.</p>
            {preflight?.blockedActions.some((item) => preflight.plan.actions.find((action) => action.id === item.actionId)?.actionType === "TRANSFER_NATIVE") && (
              <p className="mt-4 flex items-start gap-2 text-xs leading-5 text-warning"><TriangleAlert className="mt-0.5 size-3.5 shrink-0" />Native OKB is blocked until a verified sponsored EIP-7702 or private atomic bundle adapter is available.</p>
            )}
            {error && <p role="alert" className="mt-4 flex items-start gap-2 text-xs leading-5 text-danger"><TriangleAlert className="mt-0.5 size-3.5 shrink-0" />{error}</p>}
          </aside>
        </div>
      </section>
    </main>
  );
}
