import type { TokenCard as TokenCardType } from "@robbed/shared";
import Link from "next/link";

import { EthAmount } from "@/shared/ui";
import { ProgressBar } from "@/shared/ui";
import { RelativeTime } from "@/shared/ui";
import { TokenAvatar } from "@/shared/ui";
import { UsdAmount } from "@/shared/ui";
import { Badge } from "@/shared/ui";
import { formatPercent, shortAddress } from "@/shared/lib/format";

/**
 * King of the Hill hero (§5.1) — the token closest to graduation, volume-weighted.
 * DECISION: ranking is API-owned (`progress × ln(1+vol24h)`, spec §12.22); this
 * component RENDERS whatever `GET /v1/tokens/king-of-the-hill` returns and never
 * ranks/computes client-side. Server-rendered (single `<Link>`, no nested
 * anchors) so it is meaningful above the fold without client JS (§5.1 states).
 *
 * `token: null` (no pre-grad tokens exist yet) → the caller hides the hero and
 * shows the empty-chain grid state; this component renders nothing in that case.
 */
export function KingOfTheHillHero({ token }: { token: TokenCardType | null }) {
  if (!token) return null;
  const delta = token.change24hPct;
  const deltaClass =
    delta === null ? "text-muted-foreground" : delta >= 0 ? "text-buy" : "text-sell";

  return (
    <Link
      href={`/t/${token.address}`}
      className="block rounded-lg border border-border bg-surface-2 p-4 transition-colors hover:border-muted-foreground/40"
    >
      <div className="mb-3 flex items-center gap-2">
        <Badge variant="soft-confirmed">👑 King of the Hill</Badge>
        <span className="text-xs text-muted-foreground">Closest to graduation</span>
      </div>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <TokenAvatar
          imageUrl={token.imageUrl}
          name={token.name}
          ticker={token.ticker}
          size={64}
          className="h-16 w-16"
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="truncate text-lg font-semibold text-foreground">{token.name}</h2>
            <span className="text-sm uppercase tracking-wide text-muted-foreground">
              {token.ticker}
            </span>
            {token.graduated && <Badge variant="finalized">Graduated</Badge>}
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            by <span className="font-mono">{shortAddress(token.creator)}</span> ·{" "}
            <RelativeTime unixSeconds={token.createdAt} /> old
          </p>
          <div className="mt-3 max-w-md">
            <ProgressBar pct={token.progressPct} graduated={token.graduated} label="Graduation" />
          </div>
        </div>
        <div className="flex gap-6 sm:flex-col sm:items-end sm:gap-2">
          <div className="flex flex-col sm:items-end">
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Mcap</span>
            <UsdAmount value={token.mcap} className="text-base font-semibold text-foreground" />
          </div>
          <div className="flex flex-col sm:items-end">
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
              24h Vol
            </span>
            <EthAmount wei={token.volume24h} unit="ETH" className="text-sm font-medium" />
          </div>
          <div className="flex flex-col sm:items-end">
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">24h Δ</span>
            <span className={`text-sm font-medium tabular-nums ${deltaClass}`}>
              {formatPercent(delta, { signed: true })}
            </span>
          </div>
        </div>
      </div>
    </Link>
  );
}
