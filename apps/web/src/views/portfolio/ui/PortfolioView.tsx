import { AppHeader } from "@/widgets/app-header";
import { MobileNav } from "@/widgets/mobile-nav";
import { LiveStatusBanner } from "@/widgets/live-status-banner";
import { CursorTag, MonoLabel } from "@/shared/ui";

/**
 * Portfolio `/portfolio` — Phase F PLACEHOLDER shell (ROBBED_ mockup "2c").
 * The Portfolio page agent (Phase P) replaces the main content with the real
 * screen: address·you header, stat cells (TOTAL VALUE / LOOT ALL-TIME /
 * WALLET ETH), HOLDINGS/ACTIVITY/CREATED tabs, holdings table — all from live
 * indexer/on-chain data (§2: no mocked metrics; the shell intentionally shows
 * none).
 */
export default function PortfolioView() {
  return (
    <>
      <LiveStatusBanner />
      <AppHeader />
      <main className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-6 pb-16 md:pb-6">
        <MonoLabel>Portfolio</MonoLabel>
        <p className="text-sm text-muted">
          Connect a wallet to see holdings, activity, and created tokens.
        </p>
        <CursorTag>coming online</CursorTag>
      </main>
      <MobileNav />
    </>
  );
}
