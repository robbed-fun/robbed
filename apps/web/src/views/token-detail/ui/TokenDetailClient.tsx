"use client";

import type { Candle, HolderRow, Paginated, TokenDetail, TradeRow } from "@robbed/shared";
import type { CSSProperties } from "react";

import { useLiveTokenDetail } from "@/entities/token";
import { OptimisticTradesProvider } from "@/entities/trade";
import { HolderTable } from "@/widgets/holder-table";
import { PriceChart, chartActivityAnchor } from "@/widgets/price-chart";
import { TradeFeed } from "@/widgets/trade-feed";
import { TradeWidget } from "@/widgets/trade-widget";

import { TD_HERO_HEIGHT } from "../config/hero";
import { TokenHeader } from "./TokenHeader";
import { TokenInfo } from "./TokenInfo";

/**
 * Client island composing the header + five interactive widgets (, web.md
 * ). It owns the SINGLE `OptimisticTradesProvider` so a trade submitted in
 * the TradeWidget appears in the TradeFeed and reconciles once — the two
 * sibling widgets never import each other; they share state through the
 * entity-layer context this view provides.
 *
 * LIVE VENUE SWITCH (TD-6) `token` here is the LIVE
 * `useLiveTokenDetail` read — the SSR snapshot seeds it, and the WS `graduated`
 * signal (or a v3-venue trade, or a reconnect refetch) flips `status` with no
 * reload. Every status-derived surface consumes the same live object: the
 * TradeWidget engine (graduating interstitial → V3 panel), the header status
 * pill (TokenHeader now renders INSIDE this island for exactly that reason — it
 * is still server-pre-rendered for the SSR pitch), and the TokenInfo V3-pool
 * link.
 *
 * REDESIGN (USER-DIRECTED 2026-07-13): the token-detail SafetyStrip block is
 * REMOVED. The LP-destiny line that briefly survived as a muted `LP_DESTINY_COPY`
 * footnote in `TokenInfo` is now ALSO REMOVED (USER-DIRECTED 2026-07-14, D-74):
 * the D-14 LP-copy sentence is no longer a required render on /t/[address]. This
 * is UI-disclosure only — LP stays permanently locked on-chain and the API still
 * returns `trust.lpCopy` — so no floor survives on this page. Graduation
 * progress/status still live on the Discover carousel + TokenCard. The trade feed
 * + holders table are the common server-sorted, paginated `DataTable`.
 *
 * Interactive islands hydrate from SSR `initialData`, so there is no double-fetch
 * flash while the client query becomes authoritative for live WS patching.
 */
export function TokenDetailClient({
  token: initialToken,
  initialTrades,
  initialHolders,
  initialCandles,
}: {
  token: TokenDetail;
  initialTrades?: TradeRow[];
  initialHolders?: Paginated<HolderRow>;
  initialCandles?: { candles: Candle[] };
}) {
  const token = useLiveTokenDetail(initialToken);
  const chartActivityAnchorSec = chartActivityAnchor(token, initialTrades);

  return (
    <OptimisticTradesProvider>
      <TokenHeader token={token} />

      {/* Row 1 — chart | trade widget, split 8:4. MOBILE-FIRST: single column (chart
          above the widget, fixed mobile height); ≥lg an 8:4 grid at the hero height,
          both columns stretched to equal height. */}
      <div
        style={{ "--td-hero-h": TD_HERO_HEIGHT } as CSSProperties}
        className="grid grid-cols-1 gap-2 lg:h-[var(--td-hero-h)] lg:grid-cols-12"
      >
        <div className="h-[320px] min-w-0 lg:col-span-8 lg:h-auto">
          <PriceChart
            token={token}
            initialCandles={initialCandles}
            activityAnchorSec={chartActivityAnchorSec}
          />
        </div>
        <div className="min-w-0 lg:col-span-4">
          <TradeWidget token={token} />
        </div>
      </div>

      {/* Row 2 — (feed + info) | holders, split 8:4 to LINE UP under row 1 (holders
          under the widget, feed under the chart). MOBILE-FIRST: stacked; ≥lg the same
          12-col grid. `min-w-0` lets the DataTables truncate inside their column. */}
      <div className="grid grid-cols-1 gap-2 lg:grid-cols-12 pt-2">
        <div className="flex min-w-0 flex-col gap-6 lg:col-span-8">
          <TradeFeed token={token} initialTrades={initialTrades} />
          <TokenInfo token={token} />
        </div>
        <div className="min-w-0 lg:col-span-4">
          <HolderTable token={token} initialData={initialHolders} />
        </div>
      </div>
    </OptimisticTradesProvider>
  );
}
