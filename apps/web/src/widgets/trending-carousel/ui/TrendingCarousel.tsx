import type { TokenCard } from "@robbed/shared";
import Link from "next/link";

import { Delta, MonoLabel, MonoText } from "@/shared/ui";
import { cn } from "@/shared/lib/utils";

/**
 * TRENDING carousel (Discover, ROBBED_ redesign — docs/Robbed.html "2d").
 *
 * A horizontally-scrolling strip of ranked token cards (image · #rank · name +
 * ticker · 24h Δ%). Server-rendered (plain `<Link>`s, no client JS) so the
 * viral above-the-fold content paints without hydration.
 *
 * DATA/DISCIPLINE (§2): ranking is API-owned — the view fetches
 * `/v1/tokens?sort=volume24h` ("the day's biggest heists · by 24h volume") and
 * this component RENDERS the returned order, computing nothing. The mockup's
 * vivid per-token gradients are supplied by the token IMAGE itself (full-bleed);
 * the only overlay is a token-color scrim for text legibility — no raw color
 * ever leaves the design-token system (web.md §8.3 lint).
 */
export function TrendingCarousel({ tokens }: { tokens: TokenCard[] }) {
  if (tokens.length === 0) return null;
  return (
    <section aria-label="Trending tokens">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-3 md:px-6">
        <MonoLabel tone="default" className="font-semibold">
          TRENDING
        </MonoLabel>
        <MonoText tone="faint" size="xs">
          the day&apos;s biggest heists · by 24h volume
        </MonoText>
      </div>
      <div className="flex snap-x gap-3 overflow-x-auto px-4 pb-4 md:px-6">
        {tokens.map((token, i) => (
          <TrendingCard key={token.address} token={token} rank={i + 1} />
        ))}
      </div>
    </section>
  );
}

function TrendingCard({ token, rank }: { token: TokenCard; rank: number }) {
  return (
    <Link
      href={`/t/${token.address}`}
      aria-label={`${token.name} (${token.ticker}) — rank ${rank}`}
      className="group relative h-[168px] w-[248px] shrink-0 snap-start overflow-hidden bg-surface-2 md:w-[300px]"
    >
      {token.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- user-supplied R2 origins are env-gated for next/image (see TokenAvatar)
        <img
          src={token.imageUrl}
          alt={token.name}
          loading="lazy"
          decoding="async"
          className="absolute inset-0 h-full w-full object-cover"
        />
      ) : (
        <span
          aria-hidden
          className="absolute inset-0 flex items-center justify-center text-4xl font-semibold text-muted"
        >
          {(token.ticker || token.name).slice(0, 3).toUpperCase()}
        </span>
      )}

      {/* legibility scrim — token colors only (§8.3) */}
      <span
        aria-hidden
        className="absolute inset-0 bg-gradient-to-t from-bg via-bg/40 to-transparent"
      />

      {/* rank chip — mockup: solid near-black bg, green text, no border */}
      <span
        className={cn(
          "absolute left-2.5 top-2.5 bg-bg px-2 py-0.5",
          "text-2xs tracking-label tabular-nums text-green",
        )}
      >
        #{rank}
      </span>

      {/* footer: name + ticker · Δ% */}
      <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 p-3">
        <span className="flex min-w-0 items-baseline gap-1.5">
          <MonoText tone="default" size="base" className="truncate font-semibold">
            {token.name}
          </MonoText>
          <MonoText tone="tertiary" size="xs" className="shrink-0 uppercase">
            {token.ticker}
          </MonoText>
        </span>
        <Delta value={token.change24hPct} className="shrink-0 text-sm" />
      </div>
    </Link>
  );
}
