import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex min-h-6 items-center gap-1.5 rounded px-2 py-1 font-mono text-[10px] font-semibold uppercase leading-none",
  {
    variants: {
      variant: {
        neutral: "border border-border-strong bg-surface-raised text-muted",
        success: "border border-accent/35 bg-accent/10 text-accent-strong",
        warning: "border border-warning/35 bg-warning/10 text-warning",
        danger: "border border-danger/35 bg-danger/10 text-danger",
        info: "border border-info/35 bg-info/10 text-info",
      },
    },
    defaultVariants: {
      variant: "neutral",
    },
  },
);

export function Badge({
  className,
  variant,
  children,
}: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant }), className)}>{children}</span>;
}
