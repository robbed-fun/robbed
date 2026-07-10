import type { TokenCard } from "@robbed/shared";
import Link from "next/link";

import { Delta, MonoText } from "@/shared/ui";
import { cn } from "@/shared/lib/utils";

/**
 * TRENDING carousel (Discover, ROBBED_ redesign — docs/Robbed.html "2d").
 *
 * Pixel-matched to the mockup: a full-bleed marquee of ranked 300×168 cards
 * (image · #rank · name + ticker · 24h Δ%) that auto-scrolls left via the pure-CSS
 * `feat-scroll` keyframe (translateX 0 → -50% over 32s). The track holds the token
 * set TWICE so the -50% wrap is seamless. Server-rendered (plain `<Link>`s, no
 * client JS — the animation is CSS-only) so the viral above-the-fold content
 * paints without hydration; it pauses on hover and honours `prefers-reduced-motion`.
 *
 * DATA/DISCIPLINE (§2): ranking is API-owned — the view fetches
 * `/v1/tokens?sort=volume24h` ("the day's biggest heists · by 24h volume") and
 * this component RENDERS the returned order, computing nothing. The card's vivid
 * look is supplied by the token IMAGE itself (full-bleed, object-cover); the only
 * overlay is the mockup's bottom scrim gradient (bg-token only) — no raw color
 * ever leaves the design-token system (web.md §8.3 lint).
 */
export function TrendingCarousel({ tokens }: { tokens: TokenCard[] }) {
  if (tokens.length === 0) return null;
  // Two identical sets → the marquee's translateX(-50%) lands the second set
  // exactly where the first began, for a seamless infinite loop (mockup #2d).
  const track = [...tokens, ...tokens];
  return (
    <section
      aria-label="Trending tokens"
      className="flex flex-col gap-3 border-b border-border pb-4 pt-3.5"
    >
      <div className="flex items-center gap-2.5 px-6">
        <MonoText tone="default" size="xs" className="tracking-label">
          TRENDING
        </MonoText>
        <MonoText tone="faint" size="xs">
          the day&apos;s biggest heists · by 24h volume
        </MonoText>
      </div>
      <div className="overflow-hidden">
        <div className="flex w-max animate-feat-scroll hover:[animation-play-state:paused] motion-reduce:animate-none">
          {track.map((token, i) => (
            <TrendingCard
              key={`${token.address}-${i}`}
              token={token}
              rank={(i % tokens.length) + 1}
              aria-hidden={i >= tokens.length}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

function TrendingCard({
  token,
  rank,
  "aria-hidden": ariaHidden,
}: {
  token: TokenCard;
  rank: number;
  "aria-hidden"?: boolean;
}) {
  return (
    <Link
      href={`/t/${token.address}`}
      aria-label={`${token.name} (${token.ticker}) — rank ${rank}`}
      aria-hidden={ariaHidden}
      tabIndex={ariaHidden ? -1 : undefined}
      className="group relative mr-3 h-[168px] w-[300px] shrink-0 overflow-hidden bg-surface-2"
    >
      {token.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- user-supplied R2 origins are env-gated for next/image (see TokenAvatar)
        <img
          src={token.imageUrl}
          alt={token.name}
          width={300}
          height={168}
          loading="lazy"
          decoding="async"
          className="absolute inset-0 block h-full w-full object-cover"
        />
      ) : (
        <span
          aria-hidden
          className="absolute inset-0 flex items-center justify-center text-4xl font-semibold text-muted"
        >
          {(token.ticker || token.name).slice(0, 3).toUpperCase()}
        </span>
      )}

      {/* rank chip — mockup: solid near-black (bg) fill, green text, no border */}
      <span
        className={cn(
          "absolute left-2.5 top-2.5 bg-bg px-2 py-[3px]",
          "text-2xs tracking-[0.08em] tabular-nums text-green",
        )}
      >
        #{rank}
      </span>

      {/* footer scrim + name/ticker/Δ% (mockup: single bottom gradient, no full-card scrim) */}
      <div className="absolute inset-x-0 bottom-0 flex items-baseline gap-2 bg-gradient-to-b from-transparent to-bg/[0.92] px-3 pb-2.5 pt-[26px]">
        <MonoText tone="default" size="base" className="truncate font-semibold">
          {token.name}
        </MonoText>
        <MonoText tone="tertiary" size="xs" className="shrink-0 uppercase">
          {token.ticker}
        </MonoText>
        <Delta value={token.change24hPct} className="ml-auto shrink-0" />
      </div>
    </Link>
  );
}
