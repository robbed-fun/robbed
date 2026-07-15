"use client";

import type { TokenCard as TokenCardType, UsdValue } from "@robbed/shared";
import type { ReactNode } from "react";
import { useRouter } from "next/navigation";

import { CopyAddressButton } from "@/shared/ui";
import { EthAmount } from "@/shared/ui";
import { GraduationProgress } from "@/shared/ui";
import { RelativeTime } from "@/shared/ui";
import { TokenAvatar } from "@/shared/ui";
import { UsdAmount } from "@/shared/ui";
import { TokenAddressLink } from "./TokenAddressLink";
import { formatPercent, shortAddress } from "@/shared/lib/format";
import { cn } from "@/shared/lib/utils";

/**
 * Discover / Created token card (D-70 rich card — pump.fun / robinhood.fun style).
 * Field set EXACTLY: image · name · ticker · description · mcap (ETH) · 24h Δ% ·
 * graduation status · Vol 24h (ETH) · creator · age.
 *
 * Every metric is an indexer aggregate rendered BY REFERENCE — this component
 * performs ZERO market math and holds no metric constant (no-market-metrics).
 * `global:metrics` snapshots patch the cached `TokenCard` (D-70), so a swap
 * live-updates mcap / vol / Δ% / progress / status here with no reload.
 *
 * DENOMINATION (D-70 / no-market-metrics): mcap + Vol 24h render ETH-first from
 * `mcapEth` / `volume24h` (wei). The USD mirror renders ONLY where a real live
 * ETH/USD feed exists (`ethUsd > 0`); on testnet (no feed, `ethUsd == 0`) NO USD
 * is fabricated — `UsdAmount` would otherwise print a live-priced zero figure.
 *
 * GRADUATION COPY (HARD RULE — D-14 / D-65 / lp-copy): curve → "{n}% to
 * graduation"; graduated → "Graduated · Uniswap V3". The forbidden LP verb never
 * appears — the full LP-destiny sentence stays token-detail-only (D-65); the card
 * carries only the venue/status label. `progressPct` is a [0,1] FRACTION but
 * `GraduationProgress` expects 0–100 → multiply ×100 at the call site (D-70).
 *
 * Navigation: the card navigates via `useRouter().push` (not an `<a>` wrapper) so
 * the nested creator/Blockscout anchors stay valid HTML; hover prefetches.
 */

/** True only for a real live ETH/USD snapshot — the no-feed sentinel is `ethUsd == 0`. */
function hasLiveUsd(v: UsdValue | null | undefined): boolean {
  if (!v) return false;
  const rate = Number(v.ethUsd);
  return Number.isFinite(rate) && rate > 0 && typeof v.asOf === "string" && v.asOf !== "";
}

const clampPct = (p: number) => Math.max(0, Math.min(100, Number.isFinite(p) ? p : 0));

/** D-70 graduation-status label — venue-named; the forbidden LP verb never renders. */
function gradStatusLabel(token: TokenCardType, pct100: number): string {
  if (token.graduated || token.status === "graduated") return "Graduated · Uniswap V3";
  if (token.status === "graduating") return "Graduating · Uniswap V3";
  return `${clampPct(pct100).toFixed(1)}% to graduation`;
}

export function TokenCard({
  token,
  flashing = false,
  children,
}: {
  token: TokenCardType;
  flashing?: boolean;
  children?: ReactNode;
}) {
  const router = useRouter();
  const href = `/t/${token.address}`;
  const delta = token.change24hPct;
  const deltaClass =
    delta === null ? "text-muted-foreground" : delta >= 0 ? "text-buy" : "text-sell";
  // [0,1] fraction → 0–100 for the shared GraduationProgress / pctText (D-70).
  const pct100 = token.progressPct * 100;
  const gradStatus = token.graduated ? "graduated" : token.status;

  return (
    <div
      role="link"
      tabIndex={0}
      aria-label={`${token.name} (${token.ticker})`}
      onClick={() => router.push(href)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          router.push(href);
        }
      }}
      onMouseEnter={() => router.prefetch(href)}
      className={cn(
        "group flex cursor-pointer flex-col gap-2 rounded-lg border border-border bg-card p-3 transition-colors hover:border-muted-foreground/40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        flashing && "ring-1 ring-accent",
      )}
    >
      <div className="flex items-start gap-2">
        <TokenAvatar imageUrl={token.imageUrl} name={token.name} ticker={token.ticker} size={40} />
        <div className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-foreground">{token.name}</span>
          <span className="text-xs uppercase tracking-wide text-muted-foreground">
            {token.ticker}
          </span>
        </div>
        <RelativeTime unixSeconds={token.createdAt} className="text-xs text-muted-foreground" />
      </div>

      {/* description — server-truncated card-preview blurb (D-70); full text on /t/… */}
      {token.description ? (
        <p className="line-clamp-2 text-xs leading-snug text-muted-foreground">
          {token.description}
        </p>
      ) : null}

      <div className="flex items-end justify-between">
        <div className="flex min-w-0 flex-col">
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Mcap</span>
          {/* ETH-first (D-70); live USD mirror only where a real feed exists. */}
          <span className="flex items-baseline gap-1.5">
            <EthAmount
              wei={token.mcapEth}
              unit="ETH"
              className="text-sm font-medium text-foreground"
            />
            {hasLiveUsd(token.mcap) ? (
              <UsdAmount value={token.mcap} className="text-xs text-muted-foreground" />
            ) : null}
          </span>
        </div>
        <div className="flex flex-col items-end">
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">24h</span>
          <span className={cn("text-sm font-medium tabular-nums", deltaClass)}>
            {formatPercent(delta, { signed: true })}
          </span>
        </div>
      </div>

      {/* Graduation status (D-70): venue-named label over the shared compact bar.
          `progressPct` is a [0,1] fraction → ×100 for GraduationProgress. */}
      <div className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">{gradStatusLabel(token, pct100)}</span>
        <GraduationProgress variant="compact" progressPct={pct100} status={gradStatus} />
      </div>

      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            router.push(`/?q=${encodeURIComponent(token.creator)}`);
          }}
          className="font-mono transition-colors hover:text-foreground"
          title="Filter by creator"
        >
          by {shortAddress(token.creator)}
        </button>
        <span className="flex items-center gap-1.5">
          <span className="tabular-nums">
            Vol <EthAmount wei={token.volume24h} unit="ETH" />
          </span>
          <TokenAddressLink address={token.address} kind="token" tone="muted" />
          <CopyAddressButton value={token.address} />
        </span>
      </div>

      {children ? (
        <div
          className="border-t border-border/70 pt-3"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}
