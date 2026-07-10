import * as React from "react";

import { cn } from "@/shared/lib/utils";

/**
 * Vendored shadcn/ui Skeleton (new-york) — code we own (§12.24). Fixed-dimension
 * skeletons only (web.md §7: zero CLS); callers set width/height.
 */
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("animate-pulse rounded-md bg-secondary", className)}
      {...props}
    />
  );
}

export { Skeleton };
