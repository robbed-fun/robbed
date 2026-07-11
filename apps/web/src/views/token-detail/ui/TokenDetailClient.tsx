"use client";

import type {
  Candle,
  HolderRow,
  TokenDetail,
  TradeRow,
} from "@robbed/shared";

import { OptimisticTradesProvider } from "@/entities/trade";
import { HolderTable } from "@/widgets/holder-table";
import { PriceChart } from "@/widgets/price-chart";
import { TradeFeed } from "@/widgets/trade-feed";
import { TradeWidget } from "@/widgets/trade-widget";
import { TrustPanel } from "@/widgets/trust-panel";

import { TokenInfo } from "./TokenInfo";

/**
 * Client island composing the five interactive widgets (§5.2, web.md §3.2). It
 * owns the SINGLE `OptimisticTradesProvider` so a trade submitted in the
 * TradeWidget appears in the TradeFeed and reconciles once (§4) — the two sibling
 * widgets never import each other; they share state through the entity-layer
 * context this view provides.
 *
 * Interactive islands hydrate from SSR `initialData`, so there is no double-fetch
 * flash while the client query becomes authoritative for live WS patching.
 */
export function TokenDetailClient({
  token,
  initialTrades,
  initialHolders,
  initialCandles,
}: {
  token: TokenDetail;
  initialTrades?: TradeRow[];
  initialHolders?: { holders: HolderRow[]; holderCount: number };
  initialCandles?: { candles: Candle[] };
}) {
  return (
    <OptimisticTradesProvider>
      {/*
        Mockup layout (docs/Robbed.html "2a", template lines 367-368): FLAT
        regions on the page background — grid `1fr 320px, gap 0`, the two columns
        separated by a single vertical hairline (left column `border-r`), left
        column padded 18px/24px, trade panel self-padded 18px/20px. MOBILE-FIRST
        ordering (web.md §7): chart → trade widget → trust → trades → holders →
        info — the right rail STACKS UNDER THE CHART on mobile, not above it.

        DECISION (hoodpad-frontend): a single grid whose right rail is ONE cell
        spanning both rows decouples the two columns' vertical flow (no shared-row
        whitespace under the chart), while `order-*` gives the exact mobile
        sequence. `lg:items-start` keeps each column top-aligned. The left column
        is split across two cells (chart / trades+holders+info), so BOTH carry
        the `lg:border-r`; the chart cell's 14px bottom padding + the trade
        feed's own `border-t pt-3` reproduce the mockup's chart→tape rhythm.
      */}
      <div className="grid grid-cols-1 gap-0 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
        <div className="order-1 flex min-w-0 flex-col px-4 pb-3.5 pt-[18px] sm:px-6 lg:col-start-1 lg:row-start-1 lg:border-r lg:border-border">
          <PriceChart token={token} initialCandles={initialCandles} />
        </div>

        {/* Right rail — widgets are self-padded (mockup 18px 20px); on mobile a
            top hairline separates the rail from the chart cell above it. */}
        <div className="order-2 flex flex-col border-t border-border lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:border-t-0">
          <TradeWidget token={token} />
          <TrustPanel token={token} />
        </div>

        <div className="order-3 flex min-w-0 flex-col gap-6 px-4 pb-[18px] sm:px-6 lg:col-start-1 lg:row-start-2 lg:border-r lg:border-border">
          <TradeFeed token={token} initialTrades={initialTrades} />
          <HolderTable token={token} initialData={initialHolders} />
          <TokenInfo token={token} />
        </div>
      </div>
    </OptimisticTradesProvider>
  );
}
