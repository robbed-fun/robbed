import * as React from "react";

import { cn } from "@/shared/lib/utils";

/**
 * Vendored shadcn/ui Skeleton (new-york) — code we own. Fixed-dimension
 * skeletons only (web.md : zero CLS); callers set width/height.
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
