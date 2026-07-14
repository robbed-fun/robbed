import { MonoLabel } from "./MonoText";
import { cn } from "@/shared/lib/utils";

/**
 * Labelled stat cell (ROBBED_ Phase F) — the mockup's PRICE/VOL 24H/MCAP/…
 * header cells and the portfolio TOTAL VALUE row: faint 11px uppercase label
 * over a 12–15px value. Values are SUPPLIED (indexer/on-chain) — never computed
 * here.
 */
export function StatCell({
  label,
  size = "sm",
  align = "left",
  className,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  label: React.ReactNode;
  /** Value size: `sm` 12px (token-detail header) · `lg` 15px (portfolio). */
  size?: "sm" | "lg";
  align?: "left" | "right";
}) {
  return (
    <div
      className={cn(
        "flex min-w-0 flex-col gap-0.5",
        align === "right" && "items-end text-right",
        className,
      )}
      {...props}
    >
      <MonoLabel>{label}</MonoLabel>
      <div
        className={cn(
          "min-w-0 truncate tabular-nums text-text",
          size === "lg" ? "text-lg" : "text-sm",
        )}
      >
        {children}
      </div>
    </div>
  );
}
