/**
 * Inline-SVG sparkline (web.md §6 "price sparkline / mini-candles rendered as
 * inline SVG paths"). Business-agnostic charting: given a series of numbers it
 * emits an SVG string, returned as a `data:image/svg+xml;base64,…` URI so the OG
 * card can embed it via `<img src>`. We embed rather than nest a raw `<svg>`
 * element because satori's inline-SVG support is partial across versions, whereas
 * an `<img>` with an SVG data URI rasterises reliably through resvg.
 *
 * Colors are passed in (from the OG palette) so this stays token-agnostic and
 * carries no raw hex of its own.
 */
export type SparklineOptions = {
  width: number;
  height: number;
  stroke: string;
  fill: string;
  strokeWidth?: number;
  padding?: number;
};

/** Escape nothing beyond base64 — returns a ready-to-use `<img src>` data URI. */
export function sparklineDataUri(
  values: number[],
  opts: SparklineOptions,
): string {
  return `data:image/svg+xml;base64,${toBase64(sparklineSvg(values, opts))}`;
}

/** The raw SVG document for a sparkline over `values` (exported for testing). */
export function sparklineSvg(values: number[], opts: SparklineOptions): string {
  const { width, height, stroke, fill } = opts;
  const strokeWidth = opts.strokeWidth ?? 4;
  const pad = opts.padding ?? strokeWidth;

  const points = normalizePoints(values, width, height, pad);

  // Fewer than 2 points → a flat baseline (fresh token, "first trades incoming").
  if (points.length < 2) {
    const mid = (height / 2).toFixed(2);
    return svgWrap(
      width,
      height,
      `<line x1="${pad}" y1="${mid}" x2="${(width - pad).toFixed(2)}" y2="${mid}" ` +
        `stroke="${stroke}" stroke-width="${strokeWidth}" stroke-linecap="round" ` +
        `stroke-opacity="0.4" />`,
    );
  }

  const line = points.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(" ");
  // Area beneath the line for a subtle gradient-free fill band.
  const area =
    `${pad.toFixed(2)},${(height - pad).toFixed(2)} ` +
    line +
    ` ${(width - pad).toFixed(2)},${(height - pad).toFixed(2)}`;

  return svgWrap(
    width,
    height,
    `<polygon points="${area}" fill="${fill}" fill-opacity="0.18" />` +
      `<polyline points="${line}" fill="none" stroke="${stroke}" ` +
      `stroke-width="${strokeWidth}" stroke-linejoin="round" stroke-linecap="round" />`,
  );
}

function normalizePoints(
  values: number[],
  width: number,
  height: number,
  pad: number,
): { x: number; y: number }[] {
  const finite = values.filter((v) => Number.isFinite(v));
  if (finite.length === 0) return [];
  if (finite.length === 1) {
    const y = height / 2;
    return [
      { x: pad, y },
      { x: width - pad, y },
    ];
  }

  const min = Math.min(...finite);
  const max = Math.max(...finite);
  const span = max - min || 1; // flat series → straight mid-line
  const innerW = width - pad * 2;
  const innerH = height - pad * 2;
  const step = innerW / (finite.length - 1);

  return finite.map((v, i) => ({
    x: pad + i * step,
    // SVG y grows downward; invert so higher price sits higher.
    y: pad + innerH - ((v - min) / span) * innerH,
  }));
}

function svgWrap(width: number, height: number, inner: string): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" ` +
    `viewBox="0 0 ${width} ${height}">${inner}</svg>`
  );
}

function toBase64(s: string): string {
  // Buffer in Node (server-only OG path); the OG route never runs client-side.
  return Buffer.from(s, "utf8").toString("base64");
}
