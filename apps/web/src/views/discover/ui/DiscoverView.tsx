import { AppHeader } from "@/widgets/app-header";
import { EventTape } from "@/widgets/event-tape";
import { LiveStatusBanner } from "@/widgets/live-status-banner";
import { MobileNav } from "@/widgets/mobile-nav";
import { NetworkBanner } from "@/widgets/network-banner";
import { TrendingCarousel } from "@/widgets/trending-carousel";
import { getTokens } from "@/shared/api";

/**
 * Discover `/` (§5.1) — ROBBED_ terminal redesign (spec §12.50, panel "2d").
 *
 * The screen is a single dense terminal panel: a TRENDING carousel over a live
 * event tape. Both hang off the indexer's `/v1/tokens` projection fetched
 * server-side (short `revalidate`, ~5s) so the page paints with real content
 * before the WS streams hydrate the tape.
 *
 * DECISIONS (hoodpad-frontend; basis recorded):
 * - Two isolated fetches via `Promise.allSettled` so a TRENDING failure never
 *   blanks the tape and vice versa (§5.1 error isolation). `volume24h` drives
 *   TRENDING ("by 24h volume", API-owned order — §12.22); `newest` seeds the
 *   tape's LAUNCH snapshot + the enrichment registry. The two lists are merged
 *   (deduped) for the tape so a trade on a trending-but-not-newest token still
 *   resolves its name/mcap/Δ% (never fabricated — see event-tape/model).
 * - Sort/filter/grid controls are RETIRED here: the mockup Discover is
 *   TRENDING + tape only; header search remains the discovery entry point.
 *   GAP reported (event-tape/model/events.ts): no global recent-activity REST
 *   endpoint exists, so historical trade/graduation rows arrive live over WS.
 */
export default async function DiscoverView() {
  const [trendingRes, newestRes] = await Promise.allSettled([
    getTokens({ sort: "volume24h", filter: "all", limit: 8 }, { revalidate: 5 }),
    getTokens({ sort: "newest", filter: "all", limit: 40 }, { revalidate: 5 }),
  ]);

  const trending = trendingRes.status === "fulfilled" ? trendingRes.value.tokens : [];
  const newest = newestRes.status === "fulfilled" ? newestRes.value.tokens : [];

  // Merge (dedupe by address) → the tape registry resolves aggregates for both
  // newest and trending tokens; newest ordering is preserved for the launch seed
  // (seedLaunches re-sorts by createdAt).
  const seen = new Set(newest.map((t) => t.address.toLowerCase()));
  const registryTokens = [
    ...newest,
    ...trending.filter((t) => !seen.has(t.address.toLowerCase())),
  ];

  return (
    <>
      <LiveStatusBanner />
      <NetworkBanner />
      <AppHeader />
      <main className="mx-auto max-w-6xl pb-16 md:px-4 md:py-4 md:pb-4">
        <div className="border-y border-border bg-bg md:border">
          <TrendingCarousel tokens={trending} />
          <EventTape tokens={registryTokens} />
        </div>
      </main>
      <MobileNav />
    </>
  );
}
