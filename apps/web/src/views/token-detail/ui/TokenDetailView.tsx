import { notFound } from "next/navigation";

import { LiveStatusBanner } from "@/widgets/live-status-banner";
import { AppHeader } from "@/widgets/app-header";
import { MobileNav } from "@/widgets/mobile-nav";
import { ApiError, getCandles, getHolders, getToken, getTrades } from "@/shared/api";
import { candleWindow } from "@/widgets/price-chart";

import { TokenHeader } from "./TokenHeader";
import { TokenDetailClient } from "./TokenDetailClient";

/**
 * Token Detail `/t/[address]` screen (§5.2). SERVER component: fetches the token
 * summary + first page of trades/holders/candles server-side and renders the
 * meaningful above-the-fold header (name/ticker/mcap/progress/status) without any
 * client JS — the SSR pitch requirement (spec §5.2). The interactive widgets
 * hydrate as one client island (`TokenDetailClient`) from that `initialData`.
 *
 * The per-token OG `<meta>` tags auto-wire from the sibling `opengraph-image.tsx`
 * (Next file convention, M3-8) — no explicit metadata wiring needed for og:image.
 *
 * A 404 from the token endpoint → `notFound()` (segment `not-found.tsx`). Every
 * secondary fetch is isolated (`allSettled`): a failed trades/holders/candles
 * fetch degrades that island to its own empty/loading state; it never blanks the
 * page (web.md §3.2 states).
 */
export default async function TokenDetailView({ address }: { address: string }) {
  const lower = address.toLowerCase();

  let token;
  try {
    token = await getToken(lower, { revalidate: 5 });
  } catch (err) {
    if (err instanceof ApiError && (err.status === 404 || err.code === "not_found")) {
      notFound();
    }
    throw err;
  }

  const win = candleWindow(token.status === "graduated" ? "5m" : "1m");
  const interval = token.status === "graduated" ? "5m" : "1m";
  const [tradesR, holdersR, candlesR] = await Promise.allSettled([
    getTrades(lower, { limit: 50 }, { revalidate: 5 }),
    getHolders(lower, { limit: 20 }, { revalidate: 5 }),
    getCandles(lower, interval, win, { revalidate: 5 }),
  ]);

  const initialTrades = tradesR.status === "fulfilled" ? tradesR.value.trades : undefined;
  const initialHolders = holdersR.status === "fulfilled" ? holdersR.value : undefined;
  const initialCandles = candlesR.status === "fulfilled" ? candlesR.value : undefined;

  return (
    <>
      <LiveStatusBanner />
      <AppHeader />
      <main className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-4 pb-16 md:pb-4">
        <TokenHeader token={token} />
        <TokenDetailClient
          token={token}
          initialTrades={initialTrades}
          initialHolders={initialHolders}
          initialCandles={initialCandles}
        />
      </main>
      <MobileNav />
    </>
  );
}
