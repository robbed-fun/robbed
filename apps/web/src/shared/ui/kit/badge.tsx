import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/shared/lib/utils";

/**
 * Vendored shadcn/ui Badge (new-york) — code we own (§12.24). The confirmation
 * tier variants (soft-confirmed/posted/finalized, §2.1) are token-backed here so
 * ConfirmationBadge (M3-7) composes them without new color values.
 */
const badgeVariants = cva(
  "inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium transition-colors focus:outline-none",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground",
        secondary: "border-transparent bg-secondary text-secondary-foreground",
        outline: "border-border text-foreground",
        buy: "border-transparent bg-buy/15 text-buy",
        sell: "border-transparent bg-sell/15 text-sell",
        "soft-confirmed": "border-transparent bg-soft-confirmed/15 text-soft-confirmed",
        posted: "border-transparent bg-posted/15 text-posted",
        finalized: "border-transparent bg-finalized/15 text-finalized",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

function Badge({
  className,
  variant,
  asChild = false,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "span";
  return <Comp className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
