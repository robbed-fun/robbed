import { cn } from "@/shared/lib/utils";

/**
 * Token image (§5.1/§5.2). DECISION (hoodpad-frontend; basis recorded): a plain
 * `<img>` — NOT `next/image` — because token image origins are user-supplied and
 * served from the R2 CDN whose host comes from env; `next/image`'s remote
 * allowlist is env-gated and empty in dev/CI, where it would throw at render.
 * A plain `<img>` degrades gracefully (and never blocks SSR). Revisit once the
 * R2 CDN host is fixed and allowlisted (web.md §7 prefers next/image then).
 * `imageUrl` is null until the indexer fetches metadata (indexer.md §3.1) → we
 * render a deterministic monogram fallback, no layout shift.
 */
export function TokenAvatar({
  imageUrl,
  name,
  ticker,
  size = 40,
  className,
}: {
  imageUrl: string | null;
  name: string;
  ticker: string;
  size?: number;
  className?: string;
}) {
  const monogram = (ticker || name || "?").slice(0, 3).toUpperCase();
  const dim = { width: size, height: size };
  if (!imageUrl) {
    return (
      <div
        style={dim}
        className={cn(
          // ROBBED_ (Phase F): avatars are circles in the mockup (50%).
          "flex shrink-0 items-center justify-center rounded-full bg-surface-2 text-xs font-semibold text-muted-foreground",
          className,
        )}
        aria-label={name}
      >
        {monogram}
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={imageUrl}
      alt={name}
      width={size}
      height={size}
      loading="lazy"
      decoding="async"
      style={dim}
      className={cn("shrink-0 rounded-full bg-surface-2 object-cover", className)}
    />
  );
}
