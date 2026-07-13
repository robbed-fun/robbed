"use client";

import type { TokenCard as TokenCardType } from "@robbed/shared";
import { useRouter } from "next/navigation";

import { CopyAddressButton } from "@/shared/ui";
import { EthAmount } from "@/shared/ui";
import { GraduationProgress } from "@/shared/ui";
import { RelativeTime } from "@/shared/ui";
import { TokenAvatar } from "@/shared/ui";
import { UsdAmount } from "@/shared/ui";
import { Badge } from "@/shared/ui";
import { TokenAddressLink } from "./TokenAddressLink";
import { formatPercent, shortAddress } from "@/shared/lib/format";
import { cn } from "@/shared/lib/utils";

/**
 * Discover token card — the §5.1 field set EXACTLY:
 *   image · name · ticker · mcap · progress bar · 24h Δ% · creator · age.
 *
 * All metrics are indexer-computed values off `TokenCard` (mcap is a live-priced
 * `UsdValue` carrying source+asOf; volume24h/Δ% are indexer aggregates) — this
 * component performs ZERO market math and holds no metric constant (§2).
 *
 * Navigation: DECISION — the card navigates via `useRouter().push` (not an
 * `<a>` wrapper) so the nested creator/Blockscout anchors stay valid HTML (no
 * `<a>`-in-`<a>`) while still honoring "creator click → search filtered by
 * creator" (§5.1). Hover prefetches the detail route (web.md §7 speed).
 */
export function TokenCard({
  token,
  flashing = false,
}: {
  token: TokenCardType;
  flashing?: boolean;
}) {
  const router = useRouter();
  const href = `/t/${token.address}`;
  const delta = token.change24hPct;
  const deltaClass =
    delta === null ? "text-muted-foreground" : delta >= 0 ? "text-buy" : "text-sell";

  return (
    <div
      role="link"
      tabIndex={0}
      aria-label={`${token.name} (${token.ticker})`}
      onClick={() => router.push(href)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          router.push(href);
        }
      }}
      onMouseEnter={() => router.prefetch(href)}
      className={cn(
        "group flex cursor-pointer flex-col gap-2 rounded-lg border border-border bg-card p-3 transition-colors hover:border-muted-foreground/40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        flashing && "ring-1 ring-accent",
      )}
    >
      <div className="flex items-start gap-2">
        <TokenAvatar
          imageUrl={token.imageUrl}
          name={token.name}
          ticker={token.ticker}
          size={40}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-sm font-semibold text-foreground">
              {token.name}
            </span>
            {token.graduated && (
              <Badge variant="finalized" className="shrink-0">
                Graduated
              </Badge>
            )}
          </div>
          <span className="text-xs uppercase tracking-wide text-muted-foreground">
            {token.ticker}
          </span>
        </div>
        <RelativeTime unixSeconds={token.createdAt} className="text-xs text-muted-foreground" />
      </div>

      <div className="flex items-end justify-between">
        <div className="flex flex-col">
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
            Mcap
          </span>
          <UsdAmount value={token.mcap} className="text-sm font-medium text-foreground" />
        </div>
        <div className="flex flex-col items-end">
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
            24h
          </span>
          <span className={cn("text-sm font-medium tabular-nums", deltaClass)}>
            {formatPercent(delta, { signed: true })}
          </span>
        </div>
      </div>

      {/* Graduation progress + status — the shared compact GraduationProgress
          (bar + % pre-grad, or a Graduating / Graduated pill). `progressPct` is
          the indexer's cached card value (a per-card on-chain read would be too
          costly for a list); `status`/`graduated` drive the status pill. */}
      <GraduationProgress
        variant="compact"
        progressPct={token.progressPct}
        status={token.graduated ? "graduated" : token.status}
      />

      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            router.push(`/?q=${encodeURIComponent(token.creator)}`);
          }}
          className="font-mono transition-colors hover:text-foreground"
          title="Filter by creator"
        >
          by {shortAddress(token.creator)}
        </button>
        <span className="flex items-center gap-1.5">
          <span className="tabular-nums">
            Vol <EthAmount wei={token.volume24h} unit="ETH" />
          </span>
          <TokenAddressLink address={token.address} kind="token" tone="muted" />
          <CopyAddressButton value={token.address} />
        </span>
      </div>
    </div>
  );
}
