import { LaunchForm } from "@/features/launch-token";
import { AppHeader } from "@/widgets/app-header";
import { MobileNav } from "@/widgets/mobile-nav";
import { LiveStatusBanner } from "@/widgets/live-status-banner";
import { NetworkBanner } from "@/widgets/network-banner";

/**
 * Create `/create` screen (§5.3; ROBBED_ mockup "2b — Create token"; renamed
 * from /launch by the redesign). Server shell: static above-the-fold copy
 * renders without client JS; the whole interactive flow (form, upload,
 * economics reads, stepper) hydrates inside the `features/launch-token`
 * `LaunchForm` client island. Connect-wallet lives in the header; the form
 * disables submit + prompts to connect when the wallet is absent. The Create
 * page agent (Phase P) re-skins the form itself to the mockup.
 */
export default function CreateView() {
  return (
    <>
      <LiveStatusBanner />
      <NetworkBanner />
      <AppHeader />
      {/* Mockup 2b (template 446-449): 560px column, 40/24/48 padding, 22px gap;
          16px title WITHOUT letter-spacing; 11.5px faint subtitle. Mobile keeps a
          taller bottom pad for the bottom nav (md: restores the mockup's 48px). */}
      <main className="mx-auto flex w-full max-w-[560px] flex-col gap-[22px] px-6 pb-20 pt-10 md:pb-12">
        <header className="flex flex-col gap-1.5">
          <h1 className="text-lg-plus font-semibold uppercase text-text">
            Launch a token
          </h1>
          <p className="text-xs-plus text-faint">
            Deploys on Robinhood Chain · bonding curve launch
          </p>
        </header>
        <LaunchForm />
      </main>
      <MobileNav />
    </>
  );
}
