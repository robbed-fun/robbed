"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense } from "react";

import { WalletConnectButton } from "@/features/connect-wallet";
import { SearchBox, UrlSeededSearchBox } from "@/features/search-tokens";
import { Button, Wordmark } from "@/shared/ui";
import { cn } from "@/shared/lib/utils";

/**
 * ROBBED_ app header (redesign Phase F; mockup: docs/Robbed.html, all pages).
 * Desktop (`md:`+): ROBBED_ wordmark · `discover` `portfolio` nav · search ·
 * `+ CREATE` (green outline) · wallet chip — one dense row.
 * Mobile-first: the row collapses to wordmark + wallet chip, with the search
 * box on a second row; primary nav + CREATE move to the bottom `MobileNav`
 * widget (views render both).
 *
 * Active nav state: mockup shows active = text, inactive = muted (sampled 12px
 * lowercase). `usePathname` drives it (Next 16 App Router, verified 2026-07-10).
 */
const NAV = [
  { href: "/", label: "discover" },
  { href: "/portfolio", label: "portfolio" },
] as const;

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/" || pathname.startsWith("/t/");
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AppHeader() {
  const pathname = usePathname() ?? "/";
  // Mockup line 443 (2b Create): on /create the + CREATE control renders FILLED
  // (active fill, primary text, no green border); everywhere else it is the
  // green outline (line 182 et al.).
  const onCreate = pathname === "/create" || pathname.startsWith("/create/");
  return (
    // Solid bg (mockup header sits on the flat page bg — no translucency/blur).
    <header className="sticky top-0 z-40 border-b border-border bg-bg">
      {/* Mockup header row: padding 14px 24px, gap 24px (docs/Robbed.html line 178). */}
      <div className="mx-auto flex max-w-6xl items-center gap-6 px-6 py-3.5">
        <Link href="/" aria-label="ROBBED_ home" className="shrink-0">
          <Wordmark />
        </Link>

        {/* Mockup nav gap: 18px (line 180). */}
        <nav aria-label="Primary" className="hidden items-center gap-[18px] md:flex">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive(pathname, item.href) ? "page" : undefined}
              className={cn(
                "text-sm transition-colors hover:text-text",
                isActive(pathname, item.href) ? "text-text" : "text-muted",
              )}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        {/* Mockup search: max-width 340px, 12px text (line 181). The text-sm
            override is per-instance — the kit Input default (13px) is untouched.
            URL-seeded (`?q=` creator deep link, DISC-4); the useSearchParams
            reader MUST sit under Suspense on this statically-prerendered route
            (Next 16 docs, see UrlSeededSearchBox) — the fallback is the same box
            un-seeded, so prerendered HTML stays visually identical. */}
        <div className="ml-auto hidden w-full max-w-[340px] md:block">
          <Suspense fallback={<SearchBox className="sm:max-w-none" inputClassName="text-sm" />}>
            <UrlSeededSearchBox className="sm:max-w-none" inputClassName="text-sm" />
          </Suspense>
        </div>

        <Button
          asChild
          variant="outline"
          size="sm"
          className={cn(
            "hidden md:inline-flex",
            onCreate &&
              "border-transparent bg-active text-text hover:bg-active hover:text-text",
          )}
        >
          <Link href="/create">+ CREATE</Link>
        </Button>

        <div className="ml-auto md:ml-0">
          <WalletConnectButton />
        </div>
      </div>

      {/* Mobile second row: full-width search (nav + CREATE live in MobileNav). */}
      <div className="border-t border-border-soft px-4 py-2 md:hidden">
        <Suspense fallback={<SearchBox />}>
          <UrlSeededSearchBox />
        </Suspense>
      </div>
    </header>
  );
}
