import type { Metadata } from "next";
import { LockKeyhole } from "lucide-react";

import { StartRescueForm } from "@/components/start-rescue-form";
import { Badge } from "@/components/ui/badge";

export const metadata: Metadata = {
  title: "Start Rescue",
};

export default function HomePage() {
  return (
    <main className="pb-12 sm:pb-16">
      <section className="content-shell border-x-2 border-b-2 border-border-strong bg-surface">
        <div className="grid lg:grid-cols-[minmax(0,1.45fr)_minmax(330px,0.55fr)]">
          <div className="px-5 py-10 sm:px-8 sm:py-12 lg:px-10 lg:py-14">
            <div className="mb-7 flex flex-wrap items-center gap-2">
              <Badge variant="danger">User-reported incident</Badge>
              <Badge variant="success">Local signing</Badge>
              <Badge variant="neutral">Best effort</Badge>
            </div>
            <p className="mb-3 font-mono text-xs font-bold uppercase text-foreground">
              001 / New incident
            </p>
            <h1 className="max-w-3xl text-4xl font-black leading-[1.05] sm:text-5xl lg:text-[56px]">
              Wallet incident response
            </h1>
            <p className="mt-5 max-w-2xl text-base font-medium leading-7 text-muted sm:text-lg">
              Build a verified, destination-paid rescue plan for assets held in a wallet you
              are authorised to control. Every executable route is checked against current
              mainnet state before signing.
            </p>
          </div>

          <aside className="dot-grid border-t-2 border-border-strong bg-surface-muted p-5 sm:p-8 lg:border-l-2 lg:border-t-0 lg:p-9">
            <div className="flex items-center justify-between gap-4 border-b-2 border-border-strong pb-4">
              <div>
                <p className="font-mono text-[10px] font-bold uppercase text-dim">
                  Security boundary
                </p>
                <h2 className="mt-1 text-xl font-black">Local signing only</h2>
              </div>
              <span className="flex size-11 items-center justify-center border-2 border-border-strong bg-accent">
                <LockKeyhole className="size-5" />
              </span>
            </div>

            <div className="divide-y-2 divide-border-strong border-b-2 border-border-strong">
              {[
                "Never enter a seed phrase or private key.",
                "Source and destination stay visible at signing.",
                "Recovery is best effort, never guaranteed.",
              ].map((item, index) => (
                <div key={item} className="grid grid-cols-[30px_1fr] gap-3 py-4 text-sm font-semibold leading-5">
                  <span className="font-mono text-[10px] text-dim">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  {item}
                </div>
              ))}
            </div>
          </aside>
        </div>

        <div className="border-t-2 border-border-strong px-5 py-8 sm:px-8 sm:py-10 lg:px-10">
          <div className="mb-7 section-rule">
            <p className="font-mono text-[10px] font-bold uppercase text-info">
              01 / Define recovery scope
            </p>
            <h2 className="mt-2 text-2xl font-black">Start rescue</h2>
          </div>
          <StartRescueForm />
        </div>
      </section>

    </main>
  );
}
