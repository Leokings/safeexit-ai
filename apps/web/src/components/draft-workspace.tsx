import Link from "next/link";
import { ArrowLeft, CircleDashed, LockKeyhole, ShieldAlert, ShieldCheck } from "lucide-react";

import { CopyAddress } from "@/components/copy-address";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export function DraftWorkspace({
  incidentId,
  source,
  destination,
  chainName,
}: {
  incidentId: string;
  source: string;
  destination: string;
  chainName: string;
}) {
  return (
    <main>
      <section className="border-b border-border bg-surface">
        <div className="content-shell py-8 sm:py-10">
          <Link href="/" className="mb-6 inline-flex items-center gap-2 text-xs text-muted hover:text-foreground">
            <ArrowLeft className="size-3.5" />
            Start rescue
          </Link>
          <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="mb-4 flex flex-wrap items-center gap-2">
                <Badge variant="danger">User reported compromised</Badge>
                <Badge variant="neutral">Draft / no scan</Badge>
              </div>
              <p className="font-mono text-[10px] uppercase text-dim">Incident {incidentId}</p>
              <h1 className="mt-2 text-3xl font-semibold">Rescue review draft</h1>
            </div>
            <Badge variant="info">{chainName}</Badge>
          </div>
        </div>
      </section>

      <section className="border-b border-border">
        <div className="content-shell grid py-6 md:grid-cols-2">
          <div className="min-w-0 border-b border-border pb-5 md:border-b-0 md:border-r md:pb-0 md:pr-6">
            <div className="mb-2 flex items-center gap-2">
              <ShieldAlert className="size-3.5 text-danger" />
              <span className="font-mono text-[10px] uppercase text-dim">Source</span>
            </div>
            <CopyAddress address={source} />
          </div>
          <div className="min-w-0 pt-5 md:pl-6 md:pt-0">
            <div className="mb-2 flex items-center gap-2">
              <ShieldCheck className="size-3.5 text-accent" />
              <span className="font-mono text-[10px] uppercase text-dim">Safe destination</span>
            </div>
            <CopyAddress address={destination} />
          </div>
        </div>
      </section>

      <section className="content-shell py-10 sm:py-14">
        <div className="grid gap-10 lg:grid-cols-[1fr_320px]">
          <div className="flex min-h-96 flex-col items-center justify-center border border-dashed border-border-strong bg-surface px-6 text-center">
            <span className="flex size-12 items-center justify-center rounded-md border border-border-strong bg-background text-muted">
              <CircleDashed className="size-5" />
            </span>
            <h2 className="mt-5 text-xl font-semibold">No deterministic scan has run</h2>
            <p className="mt-3 max-w-md text-sm leading-6 text-muted">
              This draft stores only the displayed incident context. Live chain scanning and
              browser wallet execution are not connected in this phase.
            </p>
            <div className="mt-6 flex items-center gap-2">
              <Badge variant="neutral">Coming soon</Badge>
              <Button disabled>
                <LockKeyhole className="size-4" />
                Start deterministic scan
              </Button>
            </div>
          </div>

          <aside className="border-l-2 border-warning bg-warning/5 p-5">
            <h2 className="text-sm font-semibold">Draft safety state</h2>
            <div className="mt-5 space-y-5">
              {[
                ["Wallet state", "Unknown"],
                ["Assets", "Not scanned"],
                ["Approvals", "Not scanned"],
                ["Rescue plan", "Not created"],
                ["Transactions", "None"],
              ].map(([label, value]) => (
                <div key={label} className="flex items-center justify-between gap-4">
                  <span className="text-xs text-muted">{label}</span>
                  <span className="font-mono text-[10px] uppercase text-warning">{value}</span>
                </div>
              ))}
            </div>
          </aside>
        </div>
      </section>
    </main>
  );
}
