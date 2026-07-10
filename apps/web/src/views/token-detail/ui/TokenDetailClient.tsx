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
        Mockup layout (docs/Robbed.html "2a"): chart column + right-rail trade
        panel, Trust panel below the widget. MOBILE-FIRST ordering (web.md §7):
        chart → trade widget → trust → trades → holders → info — the right rail
        STACKS UNDER THE CHART on mobile, not above it.

        DECISION (hoodpad-frontend): a single grid whose right rail is ONE cell
        spanning both rows decouples the two columns' vertical flow (no shared-row
        whitespace under the chart), while `order-*` gives the exact mobile
        sequence. `lg:items-start` keeps each column top-aligned.
      */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
        <div className="order-1 flex min-w-0 flex-col lg:col-start-1 lg:row-start-1">
          <PriceChart token={token} initialCandles={initialCandles} />
        </div>

        <div className="order-2 flex flex-col gap-4 lg:col-start-2 lg:row-span-2 lg:row-start-1">
          <TradeWidget token={token} />
          <TrustPanel token={token} />
        </div>

        <div className="order-3 flex min-w-0 flex-col gap-4 lg:col-start-1 lg:row-start-2">
          <TradeFeed token={token} initialTrades={initialTrades} />
          <HolderTable token={token} initialData={initialHolders} />
          <TokenInfo token={token} />
        </div>
      </div>
    </OptimisticTradesProvider>
  );
}
