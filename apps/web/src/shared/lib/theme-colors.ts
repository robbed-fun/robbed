/**
 * Read the dark-theme palette from the CSS custom properties defined in
 * `globals.css` (§12.23 token system) so canvas surfaces (lightweight-charts)
 * use the SAME tokens as the DOM without hardcoding a hex value in a widget
 * (the token-bypass lint scans widgets; `shared/lib` is exempt plumbing). The
 * fallbacks below only apply during SSR / before styles resolve.
 */
export interface ChartPalette {
  up: string;
  down: string;
  text: string;
  grid: string;
  border: string;
  graduation: string;
  volumeUp: string;
  volumeDown: string;
}

function cssVar(name: string, fallback: string): string {
  if (typeof window === "undefined" || typeof getComputedStyle !== "function") {
    return fallback;
  }
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

/**
 * Resolve the chart palette from theme tokens (client-only; SSR uses fallbacks).
 *
 * CANDLES use the DIM tokens (redesign mockup, spec §12.50 — panel "2a", template chart bars:
 * up `--color-green-soft` / down `--color-red-dim`) — NOT the bright
 * `--color-buy`/`--color-sell`, which remain the badge/side-label accents
 * elsewhere. Separate reads so the two roles can never drift into one token.
 */
export function readChartPalette(): ChartPalette {
  const up = cssVar("--color-green-soft", "#2e4a34");
  const down = cssVar("--color-red-dim", "#4a2e2e");
  return {
    up,
    down,
    text: cssVar("--color-muted-foreground", "#9ca3af"),
    grid: cssVar("--color-border", "#27272a"),
    border: cssVar("--color-border", "#27272a"),
    graduation: cssVar("--color-soft-confirmed", "#f59e0b"),
    volumeUp: up,
    volumeDown: down,
  };
}
