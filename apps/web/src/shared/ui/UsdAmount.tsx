import type { UsdValue } from "@robbed/shared";

import { formatUsd } from "@/shared/lib/format";
import { cn } from "@/shared/lib/utils";

/**
 * USD figure that ALWAYS discloses its source + timestamp (spec §2). Never a
 * bare/constant USD number — `formatUsd` throws without a live
 * `{ usd, ethUsd, asOf }` snapshot (proven by tests/format.test.ts), so a
 * hardcoded market metric can never reach the DOM. The source/asOf disclosure is
 * surfaced via the native `title` (hover) — deliberately lightweight so the dense
 * grid renders hundreds of these without per-cell Radix tooltip overhead. The
 * primary product denomination is ETH; USD is only ever this live-priced value.
 */
export function UsdAmount({
  value,
  className,
}: {
  value: UsdValue;
  className?: string;
}) {
  const { text, asOf, ethUsd, stale } = formatUsd(value);
  const disclosure = `ETH/USD ${ethUsd} · as of ${asOf}${stale ? " (stale >5m)" : ""}`;
  return (
    <span
      title={disclosure}
      className={cn("tabular-nums", stale && "opacity-70", className)}
    >
      {text}
      {stale ? <span className="ml-0.5 text-muted-foreground">*</span> : null}
    </span>
  );
}
