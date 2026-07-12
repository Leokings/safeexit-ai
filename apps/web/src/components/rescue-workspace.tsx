"use client";

import {
  Activity,
  ArrowLeft,
  ArrowRight,
  Bot,
  CheckCircle2,
  Circle,
  CircleDashed,
  FileCheck2,
  FileSearch,
  Fingerprint,
  KeyRound,
  MessageSquareText,
  Play,
  RefreshCw,
  Route,
  ShieldAlert,
  ShieldCheck,
  TerminalSquare,
  TriangleAlert,
  WalletCards,
  XCircle,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";

import { generateIncidentReport } from "@safeexit/ai";

import { CopyAddress } from "@/components/copy-address";
import { IncidentChat } from "@/components/incident-chat";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { createDemoAiContext } from "@/lib/demo-ai-context";
import { demoIncident } from "@/lib/demo-incident";
import {
  demoRuntimeStateSchema,
  type DemoRuntimeState,
} from "@/lib/demo-runtime";
import { cn } from "@/lib/utils";

const views = [
  { id: "scan", label: "Incident scan", icon: FileSearch },
  { id: "analysis", label: "AI analysis", icon: Bot },
  { id: "plan", label: "Rescue plan", icon: Route },
  { id: "simulation", label: "Simulation", icon: Activity },
  { id: "review", label: "Review & sign", icon: FileCheck2 },
  { id: "status", label: "Execution", icon: TerminalSquare },
] as const;

type ViewId = (typeof views)[number]["id"];

function formatTokenAmount(value?: string): string {
  if (!value) return "--";
  const amount = BigInt(value);
  const whole = amount / 1_000_000_000_000_000_000n;
  const remainder = amount % 1_000_000_000_000_000_000n;
  if (remainder === 0n) return `${whole.toString()} SRT`;
  return `${whole.toString()}.${remainder.toString().padStart(18, "0").replace(/0+$/, "")} SRT`;
}

function shortHash(value: string): string {
  return `${value.slice(0, 10)}...${value.slice(-8)}`;
}

function SectionHeading({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4 border-b border-border pb-6 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <p className="font-mono text-[10px] uppercase text-accent">{eyebrow}</p>
        <h2 className="mt-2 text-2xl font-semibold">{title}</h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">{description}</p>
      </div>
      {action}
    </div>
  );
}

function AddressContext({ warning = false }: { warning?: boolean }) {
  return (
    <div
      className={cn(
        "grid border border-border bg-surface md:grid-cols-[1fr_auto_1fr]",
        warning && "border-warning/40",
      )}
    >
      <div className="min-w-0 p-4 sm:p-5">
        <div className="mb-2 flex items-center gap-2">
          <ShieldAlert className="size-3.5 text-danger" />
          <span className="font-mono text-[10px] uppercase text-dim">User-reported compromised source</span>
        </div>
        <CopyAddress address={demoIncident.source} />
      </div>
      <div className="hidden items-center text-dim md:flex">
        <ArrowRight className="size-4" />
      </div>
      <div className="min-w-0 border-t border-border p-4 sm:p-5 md:border-t-0">
        <div className="mb-2 flex items-center gap-2">
          <ShieldCheck className="size-3.5 text-accent" />
          <span className="font-mono text-[10px] uppercase text-dim">Fresh safe destination</span>
        </div>
        <CopyAddress address={demoIncident.destination} />
      </div>
    </div>
  );
}

function FixtureStatus({
  state,
  loading,
  onRefresh,
}: {
  state: DemoRuntimeState | null;
  loading: boolean;
  onRefresh: () => void;
}) {
  if (state?.availability === "READY") {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="success">
          {state.executionMode === "READ_ONLY_REPLAY"
            ? "Hosted verified replay"
            : "Live local fixture"}
        </Badge>
        <Badge variant="neutral">Block {state.chain?.blockNumber ?? "--"}</Badge>
        <Button type="button" variant="ghost" size="sm" onClick={onRefresh}>
          <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
          Refresh
        </Button>
      </div>
    );
  }

  return (
    <div className="border-l-2 border-warning bg-warning/5 p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold">Local fixture unavailable</p>
          <p className="mt-1 text-xs leading-5 text-muted">
            {state?.message ?? "Checking the fixed Anvil fixture."}
          </p>
          <code className="mt-3 block font-mono text-xs text-warning">npm run demo:prepare</code>
        </div>
        <Button type="button" variant="secondary" size="sm" onClick={onRefresh}>
          <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
          Check again
        </Button>
      </div>
    </div>
  );
}

function IncidentScan({ state }: { state: DemoRuntimeState | null }) {
  const chain = state?.chain;
  const rescued = state?.actualState === "RESCUED";
  const sourceOwnsNft = chain
    ? chain.nftOwner.toLowerCase() === demoIncident.source.toLowerCase()
    : undefined;
  const tokenAtRisk = chain ? BigInt(chain.sourceTokenBalance) > 0n : undefined;
  const claimAvailable = chain ? BigInt(chain.claimableReward) > 0n : undefined;
  const approvalActive = chain ? BigInt(chain.activeAllowance) > 0n : undefined;
  const evidence = [
    {
      id: "asset:srt",
      name: "RescueToken",
      amount: formatTokenAmount(chain?.sourceTokenBalance),
      detail: "ERC-20 / source balance",
      status: tokenAtRisk === undefined ? "CHECKING" : tokenAtRisk ? "DETECTED" : "RESCUED",
    },
    {
      id: "asset:nft:1",
      name: "SAFEEXIT Demo NFT",
      amount: "Token #1",
      detail:
        sourceOwnsNft === undefined
          ? "ERC-721 / checking owner"
          : sourceOwnsNft
            ? "ERC-721 / owned by source"
            : "ERC-721 / at safe destination",
      status: sourceOwnsNft === undefined ? "CHECKING" : sourceOwnsNft ? "DETECTED" : "MOVED",
    },
    {
      id: "claim:srt",
      name: "DemoAirdrop reward",
      amount: formatTokenAmount(chain?.claimableReward),
      detail:
        claimAvailable === undefined
          ? "Checking claim state"
          : claimAvailable
            ? "Claimable by source"
            : "Claim consumed",
      status: claimAvailable === undefined ? "CHECKING" : claimAvailable ? "DETECTED" : "CLAIMED",
    },
  ];
  return (
    <div>
      <SectionHeading
        eyebrow="01 / Incident scan"
        title={rescued ? "Post-rescue state" : "Assets and permissions at risk"}
        description={
          state?.executionMode === "READ_ONLY_REPLAY"
            ? "Every value is archived from the verified Anvil fixture at the displayed block; no live chain query is being claimed. Missing scanner capabilities remain explicitly unsupported."
            : "Every value comes from the fixed Anvil contracts at the displayed block. Missing scanner capabilities remain explicitly unsupported."
        }
        action={
          <Badge variant={rescued ? "success" : "danger"}>
            {rescued ? "Exposure cleared" : "Critical incident"}
          </Badge>
        }
      />

      <div className="grid border-b border-border sm:grid-cols-2 lg:grid-cols-4">
        {[
          ["ERC-20 at source", formatTokenAmount(chain?.sourceTokenBalance), "RescueToken balanceOf"],
          ["Claimable reward", formatTokenAmount(chain?.claimableReward), "DemoAirdrop claimable"],
          [rescued ? "Active allowance" : "Dangerous approval", formatTokenAmount(chain?.activeAllowance), "Fixed attacker allowance"],
          ["NFT owner", chain ? (chain.nftOwner.toLowerCase() === demoIncident.source.toLowerCase() ? "Source wallet" : "Safe destination") : "--", "Demo NFT #1"],
        ].map(([label, value, detail]) => (
          <div key={label} className="border-b border-border py-5 sm:px-5 lg:border-b-0 lg:border-l lg:first:border-l-0">
            <p className="font-mono text-[10px] uppercase text-dim">{label}</p>
            <p className="mt-2 text-xl font-semibold">{value}</p>
            <p className="mt-1 text-xs text-muted">{detail}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-8 py-8 lg:grid-cols-[1.2fr_0.8fr]">
        <section>
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-sm font-semibold">Detected asset evidence</h3>
            <span className="font-mono text-[10px] uppercase text-dim">3 records</span>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            {evidence.map((item) => (
              <article key={item.id} className="min-h-36 border border-border bg-surface p-4">
                <div className="flex items-start justify-between gap-4">
                  <span className="flex size-8 items-center justify-center rounded-md bg-surface-muted text-muted">
                    <WalletCards className="size-4" />
                  </span>
                  <Badge variant="success">{item.status}</Badge>
                </div>
                <p className="mt-5 text-sm font-semibold">{item.name}</p>
                <p className="mt-1 font-mono text-xs text-accent">{item.amount}</p>
                <p className="mt-2 text-xs text-dim">{item.detail}</p>
              </article>
            ))}
          </div>
        </section>

        <section>
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-sm font-semibold">Approval exposure</h3>
            <Badge variant={approvalActive === undefined ? "neutral" : approvalActive ? "danger" : "success"}>
              {approvalActive === undefined
                ? "Checking"
                : approvalActive
                  ? `${formatTokenAmount(chain?.activeAllowance)} exposed`
                  : "Revoked"}
            </Badge>
          </div>
          <article className="border border-danger/35 bg-danger/5 p-5">
            <div className="flex items-center gap-3">
              <TriangleAlert className="size-5 text-danger" />
              <div>
                <p className="text-sm font-semibold">
                  {approvalActive === undefined
                    ? "Checking fixed demo allowance"
                    : approvalActive
                      ? "Fixed demo attacker allowance"
                      : "Fixed demo allowance revoked"}
                </p>
                <p className="mt-1 text-xs leading-5 text-muted">
                  {approvalActive === undefined
                    ? "Waiting for the deterministic local read."
                    : approvalActive
                      ? "This fixture spender can move 25 SRT while the allowance remains active."
                      : "The live allowance is zero; the fixed spender can no longer transfer SRT."}
                </p>
              </div>
            </div>
            <div className="mt-5 border-t border-danger/20 pt-4">
              <p className="mb-2 font-mono text-[10px] uppercase text-dim">Spender contract</p>
              <CopyAddress address={demoIncident.contracts.attackerSimulation} compact />
            </div>
          </article>
          <p className="mt-3 border-l-2 border-info bg-info/5 p-4 text-xs leading-5 text-muted">
            Permit2 discovery is unsupported in this build. It is not represented as zero.
          </p>
        </section>
      </div>
    </div>
  );
}

function IncidentAnalysis({ state }: { state: DemoRuntimeState | null }) {
  const context = useMemo(() => createDemoAiContext(state ?? undefined), [state]);
  const report = useMemo(() => generateIncidentReport(context), [context]);
  return (
    <div>
      <SectionHeading
        eyebrow="02 / AI incident analysis"
        title="Critical incident, evidence bound"
        description="The explanation layer summarizes the structured scan. It cannot author calls, change the destination, or edit the deterministic plan."
        action={<Badge variant="warning">Explanation only</Badge>}
      />
      <div className="grid gap-10 py-8 lg:grid-cols-[1.2fr_0.8fr]">
        <section>
          <div className="mb-7 flex items-start gap-4">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-md border border-danger/35 bg-danger/10 text-danger">
              <ShieldAlert className="size-5" />
            </span>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-lg font-semibold">CRITICAL INCIDENT</h3>
                <Badge variant="danger">User reported key exposure</Badge>
              </div>
              <p className="mt-3 text-sm leading-7 text-muted">
                {state?.actualState === "RESCUED"
                  ? "The supported token and NFT are now at the safe destination, the claim is consumed, and the fixed demo allowance is zero. The incident remains user-reported; the local outcome is independently verified."
                  : "The source holds a supported token and NFT, can claim an additional reward, and has an active allowance to the fixed demo attacker. SAFEEXIT prioritizes claim, transfer, then revocation."}
              </p>
            </div>
          </div>
          <div className="divide-y divide-border border-y border-border">
            {report.statements.map((statement, index) => (
              <div key={`${statement.text}:${index}`} className="grid gap-2 py-5 sm:grid-cols-[150px_1fr]">
                <p className="font-mono text-[10px] uppercase text-dim">Grounded fact {index + 1}</p>
                <div>
                  <p className="text-sm leading-6 text-muted">{statement.text}</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {statement.evidence.map((reference) => (
                      <span key={`${reference.source}:${reference.recordId}:${reference.field ?? "record"}`} className="rounded border border-border bg-surface px-1.5 py-1 font-mono text-[9px] text-dim">
                        {reference.source}:{reference.recordId}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
        <aside className="border border-border bg-surface p-5">
          <div className="flex items-center gap-3 border-b border-border pb-4">
            <Fingerprint className="size-5 text-accent" />
            <h3 className="text-sm font-semibold">Decision boundary</h3>
          </div>
          <dl className="mt-5 space-y-5">
            {[
              ["Incident claim", "User-reported"],
              ["Evidence", "Live local reads"],
              ["Executable authority", "Allowlisted script"],
              ["Valuation", "Not provided"],
              ["Recovery guarantee", "None"],
            ].map(([label, value]) => (
              <div key={label} className="flex items-start justify-between gap-4">
                <dt className="text-xs text-dim">{label}</dt>
                <dd className="text-right font-mono text-xs text-foreground">{value}</dd>
              </div>
            ))}
          </dl>
        </aside>
      </div>
    </div>
  );
}

function RescuePlan() {
  return (
    <div>
      <SectionHeading
        eyebrow="03 / Rescue plan"
        title="Four deterministic actions"
        description="Targets and recipients are fixed by the demo fixture. The AI layer cannot modify this list."
        action={<Badge variant="success">Plan hash locked</Badge>}
      />
      <div className="border-y border-border py-2">
        {demoIncident.actions.map((action) => (
          <article key={action.id} className="grid gap-4 border-b border-border py-5 last:border-b-0 md:grid-cols-[64px_1fr_170px_150px] md:items-center">
            <span className="flex size-10 items-center justify-center rounded-md border border-border-strong bg-surface font-mono text-xs text-accent">{action.number}</span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-semibold">{action.title}</h3>
                <Badge variant="warning">{action.risk}</Badge>
              </div>
              <code className="mt-2 block truncate font-mono text-xs text-muted">{action.signature}</code>
            </div>
            <div>
              <p className="font-mono text-[9px] uppercase text-dim">Expected effect</p>
              <p className="mt-1 text-xs text-muted">{action.effect}</p>
            </div>
            <div>
              <p className="font-mono text-[9px] uppercase text-dim">Dependency</p>
              <p className="mt-1 text-xs text-foreground">{action.dependencies}</p>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

function Simulation({ state }: { state: DemoRuntimeState | null }) {
  const simulation = state?.report?.simulation;
  const totalGas = simulation?.actions.reduce((total, action) => total + BigInt(action.gasUsed), 0n);
  return (
    <div>
      <SectionHeading
        eyebrow="04 / Simulation"
        title="Snapshot simulation results"
        description="The seed script executed all four transactions on an Anvil snapshot, verified final effects, tested that the fixed sweep reverted, then restored the at-risk state."
        action={<Badge variant={simulation?.status === "PASSED" ? "success" : "warning"}>{simulation?.status ?? "Unavailable"}</Badge>}
      />
      <div className="grid gap-8 py-8 lg:grid-cols-[1fr_320px]">
        <section className="border border-border bg-surface">
          <div className="grid grid-cols-[1fr_auto_auto] gap-4 border-b border-border px-4 py-3 font-mono text-[9px] uppercase text-dim sm:px-5">
            <span>Action</span><span>Gas used</span><span>Result</span>
          </div>
          {demoIncident.actions.map((action) => {
            const result = simulation?.actions.find((item) => item.id === action.id);
            return (
              <div key={action.id} className="grid grid-cols-[1fr_auto_auto] items-center gap-4 border-b border-border px-4 py-4 last:border-b-0 sm:px-5">
                <div className="min-w-0">
                  <p className="text-sm text-muted">{action.title}</p>
                  {result?.transactionHash && <p className="mt-1 truncate font-mono text-[9px] text-dim">Snapshot receipt {shortHash(result.transactionHash)}</p>}
                </div>
                <span className="font-mono text-xs text-foreground">{result ? Number(result.gasUsed).toLocaleString() : "--"}</span>
                <Badge variant={result ? "success" : "neutral"}>{result?.status ?? "Not run"}</Badge>
              </div>
            );
          })}
        </section>
        <aside className="border-l-2 border-accent bg-accent/5 p-5">
          <p className="font-mono text-[10px] uppercase text-dim">Simulation evidence</p>
          <p className="mt-3 text-3xl font-semibold">{totalGas ? Number(totalGas).toLocaleString() : "--"}</p>
          <p className="mt-1 text-xs text-muted">Total gas used across snapshot receipts</p>
          <div className="mt-6 space-y-3 text-xs text-muted">
            <p className="flex items-center gap-2"><CheckCircle2 className="size-4 text-accent" /> Final balances verified</p>
            <p className="flex items-center gap-2"><CheckCircle2 className="size-4 text-accent" /> Approval reduced to zero</p>
            <p className="flex items-center gap-2"><CheckCircle2 className="size-4 text-accent" /> Fixed sweep reverted</p>
            <p className="flex items-center gap-2"><CheckCircle2 className="size-4 text-accent" /> Snapshot restored: {simulation?.snapshotReverted ? "yes" : "no"}</p>
          </div>
        </aside>
      </div>
    </div>
  );
}

function ReviewTransactions({
  state,
  authorized,
  setAuthorized,
  starting,
  error,
  onExecute,
}: {
  state: DemoRuntimeState | null;
  authorized: boolean;
  setAuthorized: (value: boolean) => void;
  starting: boolean;
  error: string | null;
  onExecute: () => void;
}) {
  const ready = state?.availability === "READY" && state.actualState === "AT_RISK" && state.report?.simulation.status === "PASSED" && state.report.simulation.snapshotReverted;
  const localExecution = state?.executionMode === "LOCAL_FIXED_SCRIPT";
  return (
    <div>
      <SectionHeading
        eyebrow={localExecution ? "05 / Review and signing" : "05 / Transaction review"}
        title={localExecution ? "Decoded local demo signing flow" : "Decoded archived rescue plan"}
        description={
          localExecution
            ? "Review the fixed targets and authorize use of the public Anvil development signer. No production wallet or secret is accepted."
            : "Review the fixed targets and archived simulation evidence. Hosted signing and execution are intentionally unavailable."
        }
        action={
          <Badge variant="warning">
            {localExecution ? "Four local signatures" : "Four archived actions"}
          </Badge>
        }
      />
      <div className="py-8">
        <AddressContext warning />
        <div className="mt-6 border border-border bg-surface">
          {demoIncident.actions.map((action) => (
            <article key={action.id} className="grid gap-4 border-b border-border p-4 last:border-b-0 sm:p-5 lg:grid-cols-[44px_1fr_1fr_auto] lg:items-center">
              <span className="flex size-9 items-center justify-center rounded-md border border-border-strong bg-background font-mono text-[10px] text-accent">{action.number}</span>
              <div className="min-w-0"><p className="text-sm font-semibold">{action.title}</p><code className="mt-1 block truncate font-mono text-[11px] text-muted">{action.signature}</code></div>
              <div className="min-w-0"><p className="mb-1 font-mono text-[9px] uppercase text-dim">Fixed contract target</p><CopyAddress address={demoIncident.contracts[action.target]} compact /></div>
              <Badge variant="success">Supported</Badge>
            </article>
          ))}
        </div>

        {state?.actualState === "RESCUED" ? (
          <div className="mt-6 border-l-2 border-accent bg-accent/5 p-5">
            <p className="flex items-center gap-2 text-sm font-semibold"><CheckCircle2 className="size-4 text-accent" /> The fixed local rescue has already completed.</p>
          </div>
        ) : ready && localExecution ? (
          <div className="mt-6 grid gap-6 border border-warning/35 bg-warning/5 p-5 lg:grid-cols-[1fr_auto] lg:items-center">
            <label className="flex cursor-pointer items-start gap-3">
              <Checkbox checked={authorized} onChange={(event) => setAuthorized(event.target.checked)} />
              <span>
                <span className="block text-sm font-semibold">I confirm that I am authorised to control and sign for this developer-created wallet.</span>
                <span className="mt-1 block text-xs leading-5 text-muted">The local server will invoke only the fixed Anvil script using Anvil&apos;s public test key. Production signing is not implemented.</span>
              </span>
            </label>
            <Button type="button" size="lg" disabled={!authorized || starting} onClick={onExecute}>
              {starting ? <CircleDashed className="size-4 animate-spin" /> : <Play className="size-4" />}
              {starting ? "Starting local execution" : "Execute fixed Anvil rescue"}
            </Button>
          </div>
        ) : state?.executionMode === "READ_ONLY_REPLAY" ? (
          <div className="mt-6 border-l-2 border-info bg-info/5 p-5">
            <p className="text-sm font-semibold">Hosted replay is review-only</p>
            <p className="mt-2 text-xs leading-5 text-muted">
              These decoded actions and receipts come from the verified local fixture. Hosted
              execution is disabled; no signature or transaction can be requested from this page.
            </p>
          </div>
        ) : (
          <div className="mt-6 border-l-2 border-warning bg-warning/5 p-5 text-sm text-muted">
            Seed and successfully simulate the fixture before execution: <code className="font-mono text-warning">npm run demo:prepare</code>
          </div>
        )}
        {error && <p className="mt-3 text-sm text-danger" role="alert">{error}</p>}
      </div>
    </div>
  );
}

function ExecutionStatus({ state, onReview }: { state: DemoRuntimeState | null; onReview: () => void }) {
  const report = state?.report;
  const completed = report?.actions.filter((action) => action.status === "COMPLETED").length ?? 0;
  const rescued = state?.actualState === "RESCUED";
  return (
    <div>
      <SectionHeading
        eyebrow="06 / Execution and report"
        title={rescued ? "Rescue complete and verified" : report?.phase === "EXECUTING" ? "Executing fixed local plan" : "Execution status"}
        description="Progress and final values are read from the local report and independently checked against Anvil state."
        action={<Badge variant={rescued ? "success" : report?.phase === "FAILED" ? "danger" : "neutral"}>{rescued ? "Completed" : report?.phase ?? "Not ready"}</Badge>}
      />

      <div className="grid gap-8 py-8 lg:grid-cols-[1fr_0.8fr]">
        <section>
          <div className="mb-4 flex items-center justify-between"><h3 className="text-sm font-semibold">Execution progress</h3><span className="font-mono text-xs text-muted">{completed} / 4 confirmed</span></div>
          <div className="h-1.5 overflow-hidden rounded bg-surface-muted"><div className="h-full bg-accent transition-[width] duration-500" style={{ width: `${(completed / 4) * 100}%` }} /></div>
          <div className="mt-5 border-y border-border">
            {demoIncident.actions.map((action) => {
              const execution = report?.actions.find((item) => item.id === action.id);
              const Icon = execution?.status === "COMPLETED" ? CheckCircle2 : execution?.status === "FAILED" ? XCircle : execution?.status === "EXECUTING" ? CircleDashed : Circle;
              return (
                <div key={action.id} className="grid grid-cols-[28px_1fr_auto] items-center gap-3 border-b border-border py-4 last:border-b-0">
                  <Icon className={cn("size-4", execution?.status === "COMPLETED" ? "text-accent" : execution?.status === "FAILED" ? "text-danger" : execution?.status === "EXECUTING" ? "animate-spin text-warning" : "text-dim")} />
                  <div className="min-w-0"><p className="text-sm font-semibold">{action.title}</p>{execution?.transactionHash && <p className="mt-1 truncate font-mono text-[10px] text-dim">{shortHash(execution.transactionHash)} / {Number(execution.gasUsed).toLocaleString()} gas</p>}</div>
                  <Badge variant={execution?.status === "COMPLETED" ? "success" : execution?.status === "FAILED" ? "danger" : execution?.status === "EXECUTING" ? "warning" : "neutral"}>{execution?.status ?? "Waiting"}</Badge>
                </div>
              );
            })}
          </div>
          {!rescued && report?.phase !== "EXECUTING" && (
            <Button type="button" variant="secondary" className="mt-5" onClick={onReview}><KeyRound className="size-4" /> Review local signing flow</Button>
          )}
        </section>

        <aside className="border border-border bg-surface p-5">
          <div className="flex items-center gap-3 border-b border-border pb-4"><TerminalSquare className="size-5 text-accent" /><h3 className="text-sm font-semibold">Event log</h3></div>
          <div className="mt-4 space-y-4">
            {(report?.events ?? []).slice(-6).map((event) => (
              <div key={`${event.sequence}:${event.at}`} className="grid grid-cols-[22px_1fr] gap-2">
                <span className="font-mono text-[9px] text-dim">{String(event.sequence).padStart(2, "0")}</span>
                <div><p className="text-xs text-muted">{event.label}</p><p className="mt-1 font-mono text-[9px] uppercase text-dim">{event.status}</p></div>
              </div>
            ))}
          </div>
        </aside>
      </div>

      {rescued && state.chain && report && (
        <section className="border-t border-accent/40 bg-accent/5 py-7">
          <div className="flex flex-col gap-4 px-5 sm:flex-row sm:items-start sm:justify-between">
            <div><p className="font-mono text-[10px] uppercase text-accent">Final incident report</p><h3 className="mt-2 text-xl font-semibold">Supported assets rescued</h3><p className="mt-2 max-w-2xl text-sm leading-6 text-muted">The claim was consumed, 150 SRT and Demo NFT #1 moved to the fresh wallet, the allowance is zero, and the fixed post-rescue sweep reverted.</p></div>
            <Badge variant="success">Verified at block {state.chain.blockNumber}</Badge>
          </div>
          <dl className="mt-6 grid border-y border-border sm:grid-cols-2 lg:grid-cols-5">
            {[
              ["Source SRT", formatTokenAmount(state.chain.sourceTokenBalance)],
              ["Destination SRT", formatTokenAmount(state.chain.destinationTokenBalance)],
              ["Claimable", formatTokenAmount(state.chain.claimableReward)],
              ["Allowance", formatTokenAmount(state.chain.activeAllowance)],
              ["NFT #1", "Safe destination"],
            ].map(([label, value]) => <div key={label} className="border-b border-border px-5 py-4 lg:border-b-0 lg:border-l lg:first:border-l-0"><dt className="font-mono text-[9px] uppercase text-dim">{label}</dt><dd className="mt-2 text-sm font-semibold">{value}</dd></div>)}
          </dl>
        </section>
      )}

      <section className="mt-8 border-t border-border pt-7">
        <h3 className="text-sm font-semibold">Limitations</h3>
        <div className="mt-4 grid gap-4 text-xs leading-5 text-muted md:grid-cols-2">
          <p>Recovery is best effort. An EVM chain cannot distinguish the legitimate owner from another party holding the same private key.</p>
          <p>This execution path is restricted to fixed public Anvil accounts and developer-created contracts. It is not a production signing service.</p>
          <p>Permit2 discovery, arbitrary protocol positions, OKX private submission, paymasters, and production simulation providers are not connected.</p>
          <p>Snapshot success does not guarantee a future production transaction. Chain state, ordering, gas, and attacker behavior can change.</p>
        </div>
      </section>
    </div>
  );
}

export function RescueWorkspace() {
  const [activeView, setActiveView] = useState<ViewId>("scan");
  const [state, setState] = useState<DemoRuntimeState | null>(null);
  const [loading, setLoading] = useState(true);
  const [authorized, setAuthorized] = useState(false);
  const [starting, setStarting] = useState(false);
  const [executionError, setExecutionError] = useState<string | null>(null);
  const [chatOpen, setChatOpen] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/demo/state", { cache: "no-store" });
      const nextState = demoRuntimeStateSchema.parse(await response.json());
      setState(nextState);
    } catch {
      setState({
        availability: "CHAIN_OFFLINE",
        executionMode: "DISABLED",
        message: "The local demo state could not be loaded.",
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const initial = window.setTimeout(() => void refresh(), 0);
    const interval = window.setInterval(() => void refresh(), 1_000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(interval);
    };
  }, [refresh]);

  async function executeDemo() {
    setExecutionError(null);
    setStarting(true);
    setActiveView("status");
    try {
      const response = await fetch("/api/demo/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ incidentId: demoIncident.id, authorizationConfirmed: true }),
      });
      const result = (await response.json()) as { message?: string };
      if (!response.ok) throw new Error(result.message ?? "The fixed local demo was not accepted.");
      await refresh();
    } catch (error) {
      setExecutionError(error instanceof Error ? error.message : "The fixed local demo failed to start.");
      setActiveView("review");
      setStarting(false);
    }
  }

  const aiContext = useMemo(() => createDemoAiContext(state ?? undefined), [state]);
  const activeIndex = views.findIndex((view) => view.id === activeView);
  const actualState = state?.actualState;
  const incidentBadge = actualState === "RESCUED" ? "Rescued" : actualState === "EXECUTING" ? "Executing" : "Critical incident";

  return (
    <main>
      <section className="border-b border-border bg-surface">
        <div className="content-shell py-8">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="mb-4 flex flex-wrap items-center gap-2">
                <Badge variant={actualState === "RESCUED" ? "success" : "danger"}><ShieldAlert className="size-3" />{incidentBadge}</Badge>
                <Badge variant="info">
                  {state?.executionMode === "READ_ONLY_REPLAY"
                    ? "Archived Anvil fixture"
                    : "Fixed local fixture"}
                </Badge>
                <Badge variant="neutral">
                  {state?.executionMode === "READ_ONLY_REPLAY"
                    ? "Chain 31337 snapshot"
                    : "Anvil 31337"}
                </Badge>
              </div>
              <p className="font-mono text-[10px] uppercase text-dim">Incident {demoIncident.id}</p>
              <h1 className="mt-2 text-3xl font-semibold">SAFEEXIT rescue command center</h1>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-muted">This wallet&apos;s private key is user-reported exposed. SAFEEXIT helps the legitimate controller rescue supported assets into a fresh wallet.</p>
            </div>
            <Button type="button" variant="secondary" onClick={() => setChatOpen(true)}><MessageSquareText className="size-4 text-accent" />Ask grounded AI</Button>
          </div>
          <div className="mt-6"><FixtureStatus state={state} loading={loading} onRefresh={() => void refresh()} /></div>
        </div>
      </section>

      <section className="border-b border-border"><div className="content-shell py-5"><AddressContext /></div></section>

      <section className="border-b border-border bg-surface">
        <div className="content-shell overflow-x-auto">
          <div className="flex min-w-max" role="tablist" aria-label="Incident workflow">
            {views.map(({ id, label, icon: Icon }, index) => (
              <button key={id} type="button" role="tab" aria-selected={activeView === id} onClick={() => setActiveView(id)} className={cn("flex h-14 min-w-36 items-center justify-center gap-2 border-r border-border px-4 text-xs font-semibold text-muted transition-colors hover:bg-surface-muted hover:text-foreground", activeView === id && "border-b-2 border-b-accent bg-surface-muted text-foreground")}>
                <span className="font-mono text-[9px] text-dim">{String(index + 1).padStart(2, "0")}</span><Icon className="size-3.5" />{label}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="content-shell py-8 sm:py-10" role="tabpanel">
        {activeView === "scan" && <IncidentScan state={state} />}
        {activeView === "analysis" && <IncidentAnalysis state={state} />}
        {activeView === "plan" && <RescuePlan />}
        {activeView === "simulation" && <Simulation state={state} />}
        {activeView === "review" && <ReviewTransactions state={state} authorized={authorized} setAuthorized={setAuthorized} starting={starting} error={executionError} onExecute={() => void executeDemo()} />}
        {activeView === "status" && <ExecutionStatus state={state} onReview={() => setActiveView("review")} />}

        <div className="mt-5 flex items-center justify-between border-t border-border pt-6">
          <Button type="button" variant="ghost" disabled={activeIndex === 0} onClick={() => setActiveView(views[activeIndex - 1]?.id ?? "scan")}><ArrowLeft className="size-4" />Previous</Button>
          <span className="font-mono text-[10px] text-dim">{activeIndex + 1} / {views.length}</span>
          <Button type="button" variant="secondary" disabled={activeIndex === views.length - 1} onClick={() => setActiveView(views[activeIndex + 1]?.id ?? "status")}>Next<ArrowRight className="size-4" /></Button>
        </div>
      </section>
      {chatOpen && <IncidentChat context={aiContext} onClose={() => setChatOpen(false)} />}
    </main>
  );
}
