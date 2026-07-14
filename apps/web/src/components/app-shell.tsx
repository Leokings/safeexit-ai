"use client";

import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-50 border-b border-border bg-background/95 backdrop-blur-sm">
        <div className="content-shell flex h-16 items-center justify-between gap-4">
          <Link href="/" className="flex min-w-0 items-center gap-3" aria-label="SAFEEXIT AI home">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-md border border-accent/40 bg-accent/10 text-accent">
              <ShieldCheck className="size-5" />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-bold">SAFEEXIT AI</span>
              <span className="hidden font-mono text-[10px] uppercase text-dim sm:block">
                Incident response
              </span>
            </span>
          </Link>

          <div className="flex items-center gap-2 font-mono text-[10px] uppercase text-dim">
            <span className="size-1.5 rounded-full bg-accent" />
            Non-custodial
          </div>
        </div>
      </header>
      {children}
    </div>
  );
}
