"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { compactAddress } from "@/lib/utils";

export function CopyAddress({ address, compact = false }: { address: string; compact?: boolean }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(address);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <code className="truncate font-mono text-xs text-foreground">
        {compact ? compactAddress(address) : address}
      </code>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-7 shrink-0"
        onClick={copy}
        aria-label={copied ? "Address copied" : "Copy address"}
        title={copied ? "Copied" : "Copy address"}
      >
        {copied ? <Check className="size-3.5 text-accent" /> : <Copy className="size-3.5" />}
      </Button>
    </span>
  );
}
