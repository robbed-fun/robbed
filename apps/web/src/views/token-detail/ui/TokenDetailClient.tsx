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
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex min-w-0 flex-col gap-4">
          <PriceChart token={token} initialCandles={initialCandles} />
          <TradeFeed token={token} initialTrades={initialTrades} />
          <HolderTable token={token} initialData={initialHolders} />
          <TokenInfo token={token} />
        </div>
        <div className="order-first flex flex-col gap-4 lg:order-none">
          <TradeWidget token={token} />
          <TrustPanel token={token} />
        </div>
      </div>
    </OptimisticTradesProvider>
  );
}
