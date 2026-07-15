import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex min-h-6 items-center gap-1.5 rounded-[3px] border-2 border-border-strong px-2 py-1 font-mono text-[10px] font-bold uppercase leading-none",
  {
    variants: {
      variant: {
        neutral: "bg-surface-raised text-foreground",
        success: "bg-accent text-foreground",
        warning: "bg-warning/45 text-foreground",
        danger: "bg-danger/20 text-foreground",
        info: "bg-info/20 text-foreground",
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
