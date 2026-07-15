import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-[2px] px-4 text-sm font-extrabold transition-[background-color,color,box-shadow,transform] focus-visible:outline focus-visible:outline-2 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-45",
  {
    variants: {
      variant: {
        default: "border-2 border-border-strong bg-accent text-foreground shadow-[3px_3px_0_var(--border-strong)] hover:bg-accent-strong active:translate-x-0.5 active:translate-y-0.5 active:shadow-[1px_1px_0_var(--border-strong)]",
        secondary: "border-2 border-border-strong bg-surface text-foreground shadow-[3px_3px_0_var(--border-strong)] hover:bg-surface-raised active:translate-x-0.5 active:translate-y-0.5 active:shadow-[1px_1px_0_var(--border-strong)]",
        ghost: "text-muted hover:bg-surface-raised hover:text-foreground",
        danger: "border-2 border-border-strong bg-danger/15 text-foreground shadow-[3px_3px_0_var(--border-strong)] hover:bg-danger/25",
      },
      size: {
        default: "h-10 px-4",
        sm: "h-8 px-3 text-xs",
        lg: "h-12 px-5 text-base",
        icon: "size-9 px-0",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export function Button({ className, variant, size, asChild, ...props }: ButtonProps) {
  const Component = asChild ? Slot : "button";
  return (
    <Component
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
}

export { buttonVariants };
