"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { WalletConnectButton } from "@/features/connect-wallet";
import { SearchBox } from "@/features/search-tokens";
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
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-bg/95 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-2.5">
        <Link href="/" aria-label="ROBBED_ home" className="shrink-0">
          <Wordmark />
        </Link>

        <nav aria-label="Primary" className="hidden items-center gap-4 md:flex">
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

        <div className="ml-auto hidden w-full max-w-xs md:block">
          <SearchBox />
        </div>

        <Button asChild variant="outline" size="sm" className="hidden md:inline-flex">
          <Link href="/create">+ CREATE</Link>
        </Button>

        <div className="ml-auto md:ml-0">
          <WalletConnectButton />
        </div>
      </div>

      {/* Mobile second row: full-width search (nav + CREATE live in MobileNav). */}
      <div className="border-t border-border-soft px-4 py-2 md:hidden">
        <SearchBox />
      </div>
    </header>
  );
}
