import type { Metadata } from "next";
import {
  CheckCircle2,
  Eye,
  FileSearch,
  KeyRound,
  LockKeyhole,
  ShieldAlert,
} from "lucide-react";

import { StartRescueForm } from "@/components/start-rescue-form";
import { Badge } from "@/components/ui/badge";

export const metadata: Metadata = {
  title: "Start Rescue",
};

const workflow = [
  { number: "01", label: "Confirm scope", icon: ShieldAlert },
  { number: "02", label: "Inspect evidence", icon: FileSearch },
  { number: "03", label: "Simulate actions", icon: Eye },
  { number: "04", label: "Sign locally", icon: KeyRound },
] as const;

export default function HomePage() {
  return (
    <main>
      <section className="border-b border-border">
        <div className="content-shell grid min-h-[calc(100vh-64px)] gap-0 lg:grid-cols-[minmax(0,1.45fr)_minmax(320px,0.55fr)]">
          <div className="flex flex-col justify-center py-12 pr-0 lg:py-16 lg:pr-14">
            <div className="mb-8 flex flex-wrap items-center gap-2">
              <Badge variant="danger">
                <span className="size-1.5 rounded-full bg-danger" />
                Incident workspace
              </Badge>
              <Badge variant="success">Non-custodial</Badge>
              <Badge variant="neutral">Best effort</Badge>
            </div>

            <div className="mb-10 max-w-3xl">
              <p className="mb-3 font-mono text-xs uppercase text-accent">SAFEEXIT / New incident</p>
              <h1 className="max-w-2xl text-4xl font-semibold leading-tight sm:text-5xl">
                Wallet incident response
              </h1>
              <p className="mt-4 max-w-2xl text-base leading-7 text-muted">
                Prepare a controlled rescue review on a supported EVM mainnet for a wallet
                you are authorised to sign for. Wallet state must be verified before any
                action is presented for signing.
              </p>
            </div>

            <StartRescueForm />
          </div>

          <aside className="border-t border-border bg-surface px-0 py-10 lg:border-l lg:border-t-0 lg:px-10 lg:py-16">
            <div className="lg:sticky lg:top-24">
              <div className="flex items-center justify-between gap-4 border-b border-border pb-5">
                <div>
                  <p className="font-mono text-[10px] uppercase text-dim">Security boundary</p>
                  <h2 className="mt-1 text-lg font-semibold">Local signing only</h2>
                </div>
                <LockKeyhole className="size-5 text-accent" />
              </div>

              <div className="divide-y divide-border">
                {[
                  "Never enter a seed phrase or private key.",
                  "Source and destination remain visible during review.",
                  "AI explanations cannot modify executable actions.",
                  "Recovery outcomes are never guaranteed.",
                ].map((item) => (
                  <div key={item} className="flex gap-3 py-4 text-sm leading-6 text-muted">
                    <CheckCircle2 className="mt-1 size-4 shrink-0 text-accent" />
                    {item}
                  </div>
                ))}
              </div>
            </div>
          </aside>
        </div>
      </section>

      <section className="border-b border-border bg-surface">
        <div className="content-shell grid sm:grid-cols-2 lg:grid-cols-4">
          {workflow.map(({ number, label, icon: Icon }, index) => (
            <div
              key={number}
              className="flex min-h-28 items-center gap-4 border-b border-border py-6 sm:px-6 sm:first:pl-0 lg:border-b-0 lg:border-r lg:last:border-r-0"
            >
              <span className="flex size-10 shrink-0 items-center justify-center rounded-md border border-border-strong bg-background text-muted">
                <Icon className="size-4" />
              </span>
              <div>
                <p className="font-mono text-[10px] text-dim">{number}</p>
                <p className="mt-1 text-sm font-semibold">{label}</p>
                {index === 3 && (
                  <span className="mt-1 block font-mono text-[9px] uppercase text-warning">
                    Verified EVM mainnets
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
