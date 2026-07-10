import type { TokenDetail } from "@robbed/shared";

import {
  Badge,
  ProgressBar,
  RelativeTime,
  TokenAvatar,
  UsdAmount,
} from "@/shared/ui";
import { formatPercent, shortAddress } from "@/shared/lib/format";

/**
 * Token Detail above-the-fold header (§5.2, web.md §3.2). SERVER-rendered — the
 * name/ticker/mcap/progress/status pill are meaningful without client JS so
 * crawlers and JS-off users get the pitch (SSR-vs-client decision, web.md).
 *
 * The status pill is the human-visible face of the invisible venue switch:
 * Bonding curve | Graduating | Graduated → Uniswap V3.
 */
export function TokenHeader({ token }: { token: TokenDetail }) {
  const delta = token.change24hPct;
  const deltaClass =
    delta === null ? "text-muted-foreground" : delta >= 0 ? "text-buy" : "text-sell";

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface-2 p-4 sm:flex-row sm:items-center">
      <TokenAvatar
        imageUrl={token.imageUrl}
        name={token.name}
        ticker={token.ticker}
        size={56}
        className="h-14 w-14"
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="truncate text-xl font-semibold text-foreground">{token.name}</h1>
          <span className="text-sm uppercase tracking-wide text-muted-foreground">
            {token.ticker}
          </span>
          <StatusPill status={token.status} />
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">
          by <span className="font-mono">{shortAddress(token.creator.address)}</span> ·{" "}
          <RelativeTime unixSeconds={token.createdAt} /> old
        </p>
        <div className="mt-2 max-w-md">
          <ProgressBar
            pct={token.graduation.progressPct}
            graduated={token.graduated}
            label="Graduation"
          />
        </div>
      </div>
      <div className="flex gap-6 sm:flex-col sm:items-end sm:gap-1.5">
        <div className="flex flex-col sm:items-end">
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
            Market cap
          </span>
          <UsdAmount value={token.mcap} className="text-lg font-semibold text-foreground" />
        </div>
        <div className="flex flex-col sm:items-end">
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">24h</span>
          <span className={`text-sm font-medium tabular-nums ${deltaClass}`}>
            {formatPercent(delta, { signed: true })}
          </span>
        </div>
      </div>
    </div>
  );
}

function StatusPill({ status }: { status: TokenDetail["status"] }) {
  switch (status) {
    case "graduated":
      return <Badge variant="finalized">Graduated → Uniswap V3</Badge>;
    case "graduating":
      return <Badge variant="soft-confirmed">Graduating</Badge>;
    default:
      return <Badge variant="secondary">Bonding curve</Badge>;
  }
}
