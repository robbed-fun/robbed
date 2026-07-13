"use client";

import type {
  Candle,
  HolderRow,
  Paginated,
  TokenDetail,
  TradeRow,
} from "@robbed/shared";
import type { CSSProperties } from "react";

import { useLiveTokenDetail } from "@/entities/token";
import { OptimisticTradesProvider } from "@/entities/trade";
import { CommentsPanel } from "@/widgets/comments-panel";
import { HolderTable } from "@/widgets/holder-table";
import { PriceChart } from "@/widgets/price-chart";
import { SafetyStrip } from "@/widgets/safety-strip";
import { TradeFeed } from "@/widgets/trade-feed";
import { TradeWidget } from "@/widgets/trade-widget";

import { TD_HERO_HEIGHT } from "../config/hero";
import { TokenHeader } from "./TokenHeader";
import { TokenInfo } from "./TokenInfo";

/**
 * Client island composing the header + five interactive widgets (§5.2, web.md
 * §3.2). It owns the SINGLE `OptimisticTradesProvider` so a trade submitted in
 * the TradeWidget appears in the TradeFeed and reconciles once (§4) — the two
 * sibling widgets never import each other; they share state through the
 * entity-layer context this view provides.
 *
 * LIVE VENUE SWITCH (TD-6, §5.2/§12.12): `token` here is the LIVE
 * `useLiveTokenDetail` read — the SSR snapshot seeds it, and the WS `graduated`
 * signal (or a v3-venue trade, or a reconnect refetch) flips `status` with no
 * reload. Every status-derived surface consumes the same live object: the
 * TradeWidget engine (graduating interstitial → V3 panel), the header status
 * pill + bonding cell (TokenHeader now renders INSIDE this island for exactly
 * that reason — it is still server-pre-rendered for the SSR pitch), the
 * SafetyStrip live reserves/graduation, and the TokenInfo V3-pool link.
 *
 * REDESIGN (§12.57-§12.60, USER-DIRECTED 2026-07-12): the standalone Trust panel
 * is DELETED; its must-render floor (LP copy, graduation progress, live reserves)
 * relocates into the compact `SafetyStrip` above the right-column Top Holders
 * table. The trade feed + holders table are the common server-sorted, paginated
 * `DataTable`.
 *
 * Interactive islands hydrate from SSR `initialData`, so there is no double-fetch
 * flash while the client query becomes authoritative for live WS patching.
 */
export function TokenDetailClient({
  token: initialToken,
  holderCount,
  initialTrades,
  initialHolders,
  initialCandles,
}: {
  token: TokenDetail;
  holderCount?: number;
  initialTrades?: TradeRow[];
  initialHolders?: Paginated<HolderRow>;
  initialCandles?: { candles: Candle[] };
}) {
  const token = useLiveTokenDetail(initialToken);

  return (
    <OptimisticTradesProvider>
      <TokenHeader token={token} holderCount={holderCount} />

      {/*
        HERO — chart (left) + trade form (right). FIXED-HEIGHT EQUAL COLUMNS
        (layout revision 2026-07-12, supersedes the viewport-fill hero): on lg+
        the hero row is a FIXED `--td-hero-h` px height (single constant in
        ../config/hero — NOT a `100dvh - header` calc, NOT the removed
        useViewportFillHeight hook), sized to fit a MacBook 13" first screen. BOTH
        columns take `lg:h-full`, so the chart box and the trade-form box are
        EXACTLY equal-height, aligned top and bottom; `lg:items-stretch` keeps
        them flush even if one had less content. Mockup fidelity
        (redesign mockup, spec §12.50 — panel "2a"): FLAT regions on the page bg, single vertical
        hairline via the chart column's `border-r`, 320px trade rail self-padded.
        MOBILE (< lg): the two columns STACK — chart (viewport-relative height)
        then trade form — via `flex-col`; the fixed equal-height is scoped to
        `lg:*` only so the mobile layout is unchanged.
      */}
      <div
        style={{ "--td-hero-h": TD_HERO_HEIGHT } as CSSProperties}
        className="flex shrink-0 flex-col lg:h-[var(--td-hero-h)] lg:flex-row lg:items-stretch"
      >
        {/* Chart column — `min-h-0`/`min-w-0` defuse the flexbox min-content trap
            so PriceChart's `flex-1` canvas can shrink. `lg:flex-1` is scoped to lg
            ON PURPOSE: at lg the hero is a ROW so flex-1 grows the horizontal axis
            while `lg:h-full` sets the vertical fill (= the fixed hero height); on
            mobile (hero is a COLUMN) an unconditional flex-1 would put
            flex-basis:0 on the vertical main axis and override `h-[56vh]`,
            collapsing the chart. */}
        <div className="flex h-[56vh] min-h-0 min-w-0 flex-col px-4 pb-3.5 pt-[18px] sm:px-6 lg:h-full lg:flex-1 lg:border-r lg:border-border">
          <PriceChart token={token} initialCandles={initialCandles} />
        </div>

        {/* Trade rail — 320px on lg, `lg:h-full` = the SAME fixed hero height as
            the chart column, and scrolls internally if the form ever exceeds it.
            On mobile a top hairline separates it from the chart above. */}
        <div className="flex flex-col border-t border-border lg:h-full lg:w-[320px] lg:min-h-0 lg:shrink-0 lg:overflow-y-auto lg:border-t-0">
          <TradeWidget token={token} />
        </div>
      </div>

      {/*
        LOWER — detail region below the fixed hero (§12.57-§12.60 redesign). Two
        columns on lg (LEFT trade feed + token info | RIGHT SafetyStrip + Top
        Holders table) keep the 320px right rail + vertical hairline continuous
        with the hero above. MOBILE ordering: chart → trade → SAFETY → holders →
        trades → info (the safety strip is DOM-first so the relocated must-render
        floor stays above the fold on mobile), grid-placed into the right rail on
        lg (lg:order-2 / col 2).
      */}
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
        <div className="order-1 flex flex-col lg:order-2 lg:col-start-2 lg:row-start-1">
          {/* Right rail: the relocated safety floor, then the Top Holders table
              that REPLACES the deleted Trust panel (§12.58). */}
          <SafetyStrip token={token} />
          <div className="px-5 py-4">
            <HolderTable token={token} initialData={initialHolders} />
          </div>
        </div>
        <div className="order-2 flex min-w-0 flex-col gap-6 px-4 pb-[18px] pt-4 sm:px-6 lg:order-1 lg:col-start-1 lg:row-start-1 lg:border-r lg:border-border">
          <TradeFeed token={token} initialTrades={initialTrades} />
          <TokenInfo token={token} />
          {/* §12.63b: per-token comments (SIWE-authored, WS-live). Additive — it
              never gates any trade/sell path. */}
          <CommentsPanel address={token.address} />
        </div>
      </div>
    </OptimisticTradesProvider>
  );
}
