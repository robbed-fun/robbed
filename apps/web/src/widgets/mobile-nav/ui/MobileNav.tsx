"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/shared/lib/utils";

/**
 * ROBBED_ bottom navigation, mobile only (redesign Phase F). The mockup's
 * header nav (`discover` · `portfolio` · `+ CREATE`) relocates here under `md`
 * (mobile-first collapse per the redesign plan); hidden on desktop where the
 * AppHeader carries the full row. Fixed bottom bar, hairline top border,
 * safe-area padded. Views that render it add `pb-14 md:pb-0` to their main
 * so content never hides behind the bar.
 */
const ITEMS = [
  { href: "/", label: "discover" },
  { href: "/portfolio", label: "portfolio" },
  { href: "/create", label: "+ create", accent: true },
] as const;

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/" || pathname.startsWith("/t/");
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function MobileNav() {
  const pathname = usePathname() ?? "/";
  return (
    <nav
      aria-label="Primary mobile"
      className="fixed inset-x-0 bottom-0 z-40 flex border-t border-border bg-bg/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
    >
      {ITEMS.map((item) => {
        const active = isActive(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex-1 py-3 text-center text-xs transition-colors",
              "accent" in item && item.accent
                ? "text-green"
                : active
                  ? "text-text"
                  : "text-muted",
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
