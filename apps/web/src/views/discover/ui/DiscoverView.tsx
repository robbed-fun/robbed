import { Suspense } from "react";

import { DiscoverControls } from "./DiscoverControls";
import { KingOfTheHillHero } from "@/widgets/king-of-the-hill-hero";
import { LaunchTicker } from "@/widgets/launch-ticker";
import { TokenGrid } from "@/widgets/token-grid";
import { LiveStatusBanner } from "@/widgets/live-status-banner";
import { AppHeader } from "@/widgets/app-header";
import { MobileNav } from "@/widgets/mobile-nav";
import { parseFilter, parseSort } from "@/entities/token";
import { getKingOfTheHill, getTokens } from "@/shared/api";

/**
 * Discover `/` (§5.1). Server component: the hero and the grid's first page are
 * fetched server-side (short `revalidate`, ~5s) so the page paints with real
 * content and is SSR-consistent with the URL state; the live bits (ticker, grid
 * WS patches, search) are client islands hydrated on top.
 *
 * DECISIONS (hoodpad-frontend; basis recorded):
 * - SSR-vs-client split (Next 16 App Router, verified 2026-07-10): `searchParams`
 *   is a Promise → awaited here; sort/filter parsed with the SHARED zod enums
 *   (params.ts) so server and client agree on the active state. Reading
 *   `searchParams` opts the route into dynamic rendering — correct: the grid is
 *   URL-stateful and shareable. The fetch cache (`revalidate: 5`) still
 *   deduplicates upstream calls across requests.
 * - `Promise.allSettled` isolates hero vs grid failures (§5.1: "hero failure must
 *   not blank the grid and vice versa"). A rejected hero renders nothing; a
 *   rejected grid fetch drops `initialData` and the client grid refetches (and
 *   shows its own ErrorState if that also fails).
 * - The grid receives its SSR first page as `initialData`, avoiding a
 *   double-fetch flash while keeping the client query authoritative for
 *   pagination + WS patching.
 */
export default async function DiscoverPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const sp = await searchParams;
  const sort = parseSort(sp.sort);
  const filter = parseFilter(sp.filter);

  const [kothResult, gridResult] = await Promise.allSettled([
    getKingOfTheHill({ revalidate: 5 }),
    getTokens({ sort, filter, limit: 48 }, { revalidate: 5 }),
  ]);

  const koth = kothResult.status === "fulfilled" ? kothResult.value.token : null;
  const initialGrid = gridResult.status === "fulfilled" ? gridResult.value : undefined;

  return (
    <>
      <LiveStatusBanner />
      <AppHeader />
      <main className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-4 pb-16 md:pb-4">
        <KingOfTheHillHero token={koth} />
        <LaunchTicker />
        <Suspense fallback={<div className="h-9" />}>
          <DiscoverControls />
        </Suspense>
        <TokenGrid sort={sort} filter={filter} initialData={initialGrid} />
      </main>
      <MobileNav />
    </>
  );
}
