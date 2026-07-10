import { LaunchForm } from "@/features/launch-token";
import { AppHeader } from "@/widgets/app-header";
import { MobileNav } from "@/widgets/mobile-nav";
import { LiveStatusBanner } from "@/widgets/live-status-banner";
import { CursorTag } from "@/shared/ui";
import { TAGLINE_CREATE } from "@/shared/config/copy";

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
      <AppHeader />
      <main className="mx-auto flex max-w-2xl flex-col gap-4 px-4 py-6 pb-16 md:pb-6">
        <header className="flex flex-col gap-1">
          <h1 className="text-base font-semibold uppercase tracking-label text-text">
            Launch a token
          </h1>
          <p className="text-sm text-muted">
            Deploys on Robinhood Chain — ownerless, fixed 1B supply, tradeable in
            under a second, soft-confirmed on the bonding curve.
          </p>
        </header>
        <LaunchForm />
        <div className="flex justify-center pt-2">
          <CursorTag>{TAGLINE_CREATE}</CursorTag>
        </div>
      </main>
      <MobileNav />
    </>
  );
}
