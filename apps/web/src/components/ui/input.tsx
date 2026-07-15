import * as React from "react";

import { cn } from "@/lib/utils";

export function Input({ className, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      className={cn(
        "h-11 w-full rounded-[2px] border-2 border-border-strong bg-surface px-3 font-mono text-sm font-medium text-foreground placeholder:text-dim focus:bg-white focus:outline focus:outline-2 disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}
