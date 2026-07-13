import { AppHeader } from "@/widgets/app-header";
import { LiveStatusBanner } from "@/widgets/live-status-banner";
import { NetworkBanner } from "@/widgets/network-banner";
import { MobileNav } from "@/widgets/mobile-nav";

import { PortfolioClient } from "./PortfolioClient";

/**
 * Portfolio `/portfolio` (§5.4 — Phase-2 page surfaced day 1 by the ROBBED_
 * redesign, spec §12.50, page "2c"). SERVER shell: the SSR chrome (status banner,
 * header, bottom nav) matches every other view, while the wallet-scoped content
 * hydrates as one client island (`PortfolioClient`) — the subject address comes
 * from the connected wallet or an explicit `?address=`, so there is nothing
 * meaningful to server-render inside the panel until the client resolves it.
 *
 * NO mocked metrics (§2): every value under the panel is a live
 * `/v1/portfolio/*` read (totals/PnL are ETH-first with a live-priced USD
 * mirror; PnL is a nullable range — §5.2). NO OG work here (out of scope).
 */
export default async function PortfolioView({
  searchParams,
}: {
  // Next 16 App Router: `searchParams` is a Promise (verified 2026-07-10).
  searchParams?: Promise<{ address?: string | string[] }>;
}) {
  const params = (await searchParams) ?? {};
  const raw = Array.isArray(params.address) ? params.address[0] : params.address;
  const initialAddress = raw && /^0x[0-9a-fA-F]{40}$/.test(raw) ? raw : undefined;

  return (
    <>
      <LiveStatusBanner />
      <NetworkBanner />
      <AppHeader />
      <main className="mx-auto w-full max-w-6xl pb-20 md:px-4 md:py-4 md:pb-6">
        <div className="border-y border-border bg-bg md:border">
          <PortfolioClient initialAddress={initialAddress} />
        </div>
      </main>
      <MobileNav />
    </>
  );
}
