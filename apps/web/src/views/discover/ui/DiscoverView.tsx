import { AppHeader } from "@/widgets/app-header";
import { LiveStatusBanner } from "@/widgets/live-status-banner";
import { MobileNav } from "@/widgets/mobile-nav";
import { NetworkBanner } from "@/widgets/network-banner";
import { TrendingCarousel } from "@/widgets/trending-carousel";
import { getTokens } from "@/shared/api";

import { DiscoverGrid } from "./DiscoverGrid";
// DiscoverTape disabled — the grid below is the primary browse surface. Re-enable
// by uncommenting this import, the `newest`/registry block, and the render below.
// import { DiscoverTape } from "./DiscoverTape";

/**
 * Discover `/` — ROBBED_ terminal redesign (panel "2d"), AMENDED by D-70.
 *
 * A single dense terminal panel — the TRENDING carousel over the live event tape
 * — and, per D-70, a re-added rich per-token TokenCard grid BELOW them as the
 * primary browse surface. Carousel + tape are UNCHANGED. All three surfaces hang
 * off the indexer's `/v1/tokens` projection fetched server-side (short
 * `revalidate`, ~5s) so the page paints with real content before the WS streams
 * hydrate the tape and the grid live-updates over `global:metrics`.
 *
 * DECISIONS (robbed-frontend; basis recorded):
 * - THREE isolated fetches via `Promise.allSettled` (error isolation) — a grid
 *   failure never blanks the carousel/tape and vice versa. `volume24h` drives
 *   TRENDING (carousel); `newest` seeds the tape's LAUNCH snapshot + enrichment
 *   registry; the grid's default `trending`/`all` page is SSR-seeded so it paints
 *   without a client fetch flash (initialData, D-70).
 * - The tape registry is merged (deduped) from newest ∪ trending so a trade on a
 *   trending-but-not-newest token still resolves its name/mcap (never fabricated
 *   — event-tape/model). `DiscoverTape` then routes it through the `tokens` cache
 *   so `global:metrics` patches reach it by reference (D-70).
 * - Grid sort/filter are a VIEW-LOCAL control (grid URL-state stays retired —
 *   D-50; only `?q=` is a URL param); header search remains the search entry.
 */
export default async function DiscoverView() {
  const [trendingRes, gridRes] = await Promise.allSettled([
    getTokens({ sort: "volume24h", filter: "all", limit: 8 }, { revalidate: 5 }),
    getTokens({ sort: "trending", filter: "all", limit: 48 }, { revalidate: 5 }),
  ]);

  const trending = trendingRes.status === "fulfilled" ? trendingRes.value.tokens : [];
  const gridInitial = gridRes.status === "fulfilled" ? gridRes.value : undefined;

  // DiscoverTape disabled — grid is the browse surface now. To re-enable, restore the
  // `newest` fetch + tape registry (drove the tape's launch snapshot + WS enrichment):
  //   getTokens({ sort: "newest", filter: "all", limit: 40 }, { revalidate: 5 }),  // add to allSettled
  //   const newest = newestRes.status === "fulfilled" ? newestRes.value.tokens : [];
  //   const seen = new Set(newest.map((t) => t.address.toLowerCase()));
  //   const registryTokens = [...newest, ...trending.filter((t) => !seen.has(t.address.toLowerCase()))];

  return (
    <>
      <LiveStatusBanner />
      <NetworkBanner />
      <AppHeader />
      <main className="mx-auto max-w-6xl pb-16 md:px-4 md:py-4 md:pb-4">
        <div className="border-y border-border bg-bg md:border">
          <TrendingCarousel tokens={trending} />
          {/* <DiscoverTape registryTokens={registryTokens} /> — disabled; grid below is the browse surface */}
        </div>
        <DiscoverGrid initial={gridInitial} />
      </main>
      <MobileNav />
    </>
  );
}
