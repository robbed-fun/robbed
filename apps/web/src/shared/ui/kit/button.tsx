import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/shared/lib/utils";

/**
 * Vendored shadcn/ui Button (new-york, Tailwind v4) — code we own (§12.24),
 * restyled to the ROBBED_ terminal skin (Phase F; docs/Robbed.html samples):
 * square corners, mono, weight 500/600. Variant → mockup mapping:
 *   default — solid green with near-black text (LAUNCH TOKEN / BUY HCAT;
 *             bg-primary is the green accent token post-redesign)
 *   outline — GREEN outline, transparent fill (the header's `+ CREATE`;
 *             sampled: 1px #4ADE80 border, green 12px text, pad 7px 14px)
 *   ghost   — borderless muted → text on hover
 * Styling routes ONLY through design tokens; no raw color values (web.md §7).
 * buy/sell variants are token-backed trade actions (buy == default green).
 */
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-none text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary font-semibold text-primary-foreground hover:bg-primary/90",
        destructive:
          "bg-destructive font-semibold text-background hover:bg-destructive/90",
        outline:
          "border border-primary bg-transparent text-primary hover:bg-primary/10",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost: "text-muted hover:bg-secondary hover:text-text",
        link: "text-primary underline-offset-4 hover:underline",
        buy: "bg-buy font-semibold text-background hover:bg-buy/90",
        sell: "bg-sell font-semibold text-background hover:bg-sell/90",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 px-3.5 text-sm",
        lg: "h-11 px-6 text-base",
        icon: "h-9 w-9",
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

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
