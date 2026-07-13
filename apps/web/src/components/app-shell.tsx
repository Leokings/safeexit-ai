"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

const navItems = [
  { href: "/", label: "Start", icon: LayoutDashboard },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();

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

          <nav className="flex h-9 items-center rounded-md border border-border bg-surface p-1" aria-label="Primary navigation">
            {navItems.map(({ href, label, icon: Icon }) => {
              const active = href === "/" ? pathname === href : pathname.startsWith(href);
              return (
                <Link
                  key={href}
                  href={href}
                  className={cn(
                    "flex h-7 items-center gap-2 rounded px-3 text-xs font-semibold text-muted transition-colors hover:text-foreground",
                    active && "bg-surface-muted text-foreground",
                  )}
                >
                  <Icon className="size-3.5" />
                  {label}
                </Link>
              );
            })}
          </nav>

          <div className="hidden items-center gap-2 font-mono text-[10px] uppercase text-dim lg:flex">
            <span className="size-1.5 rounded-full bg-accent" />
            Non-custodial
          </div>
        </div>
      </header>
      {children}
    </div>
  );
}
