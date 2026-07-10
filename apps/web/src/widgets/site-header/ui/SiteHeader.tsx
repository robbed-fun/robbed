"use client";

import Link from "next/link";

import { WalletConnectButton } from "@/features/connect-wallet";
import { Button } from "@/shared/ui";
import { AMM_TAGLINE } from "@/shared/config/copy";

/**
 * LEGACY top bar — superseded by `widgets/app-header` + `widgets/mobile-nav`
 * (ROBBED_ redesign Phase F); no view renders it anymore. Kept ADDITIVELY so
 * nothing breaks while the Phase-P page agents finish migrating, then it gets
 * deleted. Brand/link updated so it can never show stale branding if rendered.
 */
export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-bg/80 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-2.5">
        <Link href="/" className="flex items-baseline gap-2">
          <span className="text-md font-semibold tracking-label text-foreground">
            ROBBED<span className="animate-blink text-green">_</span>
          </span>
          <span className="hidden text-xs text-muted-foreground sm:inline">
            {AMM_TAGLINE}
          </span>
        </Link>
        <div className="ml-auto flex items-center gap-2">
          <Button asChild size="sm" variant="outline">
            <Link href="/create">+ CREATE</Link>
          </Button>
          <WalletConnectButton />
        </div>
      </div>
    </header>
  );
}
