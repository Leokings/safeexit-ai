"use client";

import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-50 border-b-2 border-border-strong bg-surface/95 backdrop-blur-sm">
        <div className="content-shell flex h-[76px] items-center justify-between gap-5">
          <Link href="/" className="flex min-w-0 items-center" aria-label="SAFEEXIT home">
            <span className="relative block h-[24px] w-[148px] sm:h-[29px] sm:w-[184px]">
              <Image
                src="/safeexit-wordmark.svg"
                fill
                sizes="(min-width: 640px) 184px, 148px"
                priority
                alt="SAFEEXIT"
                className="object-contain"
              />
            </span>
          </Link>

          <div className="flex items-center gap-2.5 font-mono text-[10px] font-bold uppercase text-foreground sm:text-xs">
            <span className="status-dot" />
            Non-custodial
          </div>
        </div>
      </header>
      {children}
      <footer className="border-t-2 border-border-strong bg-surface">
        <div className="content-shell flex min-h-14 items-center justify-between gap-4 px-5 py-3 font-mono text-[10px] font-bold uppercase sm:px-8">
          <span>SAFEEXIT / Non-custodial incident response</span>
          <div className="flex items-center gap-4">
            <Link href="/support" className="underline decoration-2 underline-offset-4">
              Support
            </Link>
            <Link href="/privacy" className="underline decoration-2 underline-offset-4">
              Privacy
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
