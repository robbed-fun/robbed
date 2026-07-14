import { cn } from "@/shared/lib/utils";

/**
 * Event/trade side marker (ROBBED_ Phase F). The mockup renders sides as bare
 * colored uppercase text (11px), NOT pill badges: BUY green · SELL red ·
 * LAUNCH default text · GRADUATE purple. Sells stay renderable in every state —
 * this is display-only and never gates (lives in the trade feature).
 */
export type Side = "buy" | "sell" | "launch" | "graduate";

const SIDE_CLASS: Record<Side, string> = {
  buy: "text-green",
  sell: "text-red",
  launch: "text-text",
  graduate: "text-purple",
};

const SIDE_LABEL: Record<Side, string> = {
  buy: "BUY",
  sell: "SELL",
  launch: "LAUNCH",
  graduate: "GRADUATE",
};

export function SideBadge({
  side,
  label,
  className,
  ...props
}: React.ComponentProps<"span"> & {
  side: Side;
  /** Override the default uppercase label (e.g. "GRADUATE → AMM"). */
  label?: string;
}) {
  return (
    <span
      className={cn("text-xs uppercase", SIDE_CLASS[side], className)}
      {...props}
    >
      {label ?? SIDE_LABEL[side]}
    </span>
  );
}
