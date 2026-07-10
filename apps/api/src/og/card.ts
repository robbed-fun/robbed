/**
 * The OG card element tree fed to satori (api.md §3 OG endpoint; spec §5.2).
 * PORTED 1:1 from the frontend's `apps/web/src/widgets/token-og/ui/token-og-card.tsx`
 * (JSX → `h()` plain-object nodes; see element.ts for why). The API is now the
 * SINGLE OG renderer; the web card file is being deleted, so this is the sole copy
 * of the ROBBED_ terminal card layout — no cross-service duplication.
 *
 * ROBBED_ terminal design: mono (IBM Plex Mono), dark `#0B0D0B` canvas, green
 * accent, the `ROBBED_` wordmark with its green `_`, square panels, uppercase
 * letter-spaced micro-labels. Content (spec §5.2): chart snapshot (mini candles) +
 * MCAP (ETH + USD-with-source) + graduation progress + `rob responsibly_` footer.
 *
 * satori is Flexbox-only: every container with >1 child sets `display: 'flex'`
 * explicitly. Layout flows top→bottom; the mcap/progress block is a fixed
 * bottom section. All metrics are live indexer values (§2) — no market math here.
 */
import type { TokenCard } from "@robbed/shared";
import { h, type OgChild, type OgElement, type Style } from "./element";
import { OG_COLORS, OG_FONT_FAMILY, OG_HEIGHT, OG_TAGLINE, OG_WIDTH } from "./theme";

type TokenStatus = TokenCard["status"];

/**
 * Server-side data the card renders — the exact display fields, all live indexer
 * values (NO hardcoded metric, §2). Mirrors the frontend `TokenOgData` shape;
 * built by `og/data.ts` from the DB projections.
 */
export interface TokenOgData {
  name: string;
  ticker: string;
  imageDataUri: string | null;
  status: TokenStatus;
  graduated: boolean;
  /** 0..100 graduation progress (pre-grad); indexer-computed. */
  progressPct: number;
  /** Close prices over the OG window → mini candles. Empty = "first trades incoming". */
  sparkline: number[];
  /** mcap in ETH, pre-formatted (ETH-first, §2). `null` when unpriced. */
  mcapEth: string | null;
  /** Secondary USD with source timestamp (§2); `null` when no ETH/USD snapshot. */
  mcapUsd: { text: string; asOf: string } | null;
}

const PAD = 48;
const CONTENT_W = OG_WIDTH - PAD * 2;
const CHART_PANEL_H = 156;
const CANDLES_H = CHART_PANEL_H - 36 /* pad */ - 24 /* label */ - 14 /* gap */;
const LABEL: Style = {
  display: "flex",
  fontSize: 22,
  letterSpacing: "0.14em",
  color: OG_COLORS.faint,
};

export function buildTokenOgCard(data: TokenOgData): OgElement {
  const progress = clampPct(data.progressPct);

  return h(
    "div",
    {
      style: {
        width: OG_WIDTH,
        height: OG_HEIGHT,
        display: "flex",
        flexDirection: "column",
        backgroundColor: OG_COLORS.bg,
        color: OG_COLORS.textSecondary,
        fontFamily: OG_FONT_FAMILY,
        padding: PAD,
      },
    },
    // ── Top bar: ROBBED_ wordmark · status ─────────────────────────────────
    h(
      "div",
      { style: { display: "flex", alignItems: "center", width: "100%" } },
      wordmark(),
      h("div", { style: { display: "flex", marginLeft: "auto" } }, statusTag(data)),
    ),
    hairline(18),
    // ── Token identity: avatar · NAME TICKER ───────────────────────────────
    h(
      "div",
      { style: { display: "flex", alignItems: "center", width: "100%", marginTop: 20 } },
      logo(data),
      h(
        "div",
        {
          style: {
            display: "flex",
            flexDirection: "column",
            marginLeft: 26,
            flex: 1,
            minWidth: 0,
          },
        },
        h(
          "div",
          {
            style: {
              display: "flex",
              alignItems: "baseline",
              fontSize: 52,
              fontWeight: 600,
              color: OG_COLORS.text,
              lineHeight: 1.05,
            },
          },
          truncate(data.name, 20),
          h(
            "span",
            {
              style: {
                marginLeft: 16,
                fontSize: 26,
                fontWeight: 400,
                color: OG_COLORS.faint,
              },
            },
            data.ticker.toUpperCase(),
          ),
        ),
      ),
    ),
    // ── Chart snapshot: mini candles (price / ETH) ─────────────────────────
    h(
      "div",
      {
        style: {
          display: "flex",
          height: CHART_PANEL_H,
          flexDirection: "column",
          marginTop: 22,
          border: `1px solid ${OG_COLORS.border}`,
          backgroundColor: OG_COLORS.surface,
          padding: 18,
        },
      },
      h(
        "div",
        { style: { display: "flex", alignItems: "center", width: "100%" } },
        h("span", { style: LABEL }, "PRICE / ETH"),
      ),
      candles(data),
    ),
    // ── Bottom: MCAP · graduation ──────────────────────────────────────────
    h(
      "div",
      { style: { display: "flex", flexDirection: "column", marginTop: 22 } },
      h(
        "div",
        {
          style: {
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "space-between",
            width: "100%",
          },
        },
        mcap(data),
        graduation(data, progress),
      ),
      hairline(18),
      h(
        "div",
        { style: { display: "flex", alignItems: "center", marginTop: 14 } },
        h(
          "span",
          { style: { display: "flex", fontSize: 22, color: OG_COLORS.faint } },
          `${OG_TAGLINE}_`,
        ),
      ),
    ),
  );
}

function wordmark(): OgElement {
  return h(
    "div",
    {
      style: {
        display: "flex",
        alignItems: "baseline",
        fontSize: 34,
        fontWeight: 600,
        letterSpacing: "0.12em",
        color: OG_COLORS.text,
      },
    },
    "ROBBED",
    h("span", { style: { color: OG_COLORS.accent } }, "_"),
  );
}

function hairline(marginTop: number): OgElement {
  return h("div", {
    style: {
      display: "flex",
      width: "100%",
      height: 1,
      backgroundColor: OG_COLORS.border,
      marginTop,
    },
  });
}

function logo(data: TokenOgData): OgElement {
  if (data.imageDataUri) {
    return h("img", {
      src: data.imageDataUri,
      width: 92,
      height: 92,
      alt: "",
      style: { borderRadius: 46, objectFit: "cover" },
    });
  }
  const initial = (data.ticker || data.name || "?").charAt(0).toUpperCase();
  return h(
    "div",
    {
      style: {
        display: "flex",
        width: 92,
        height: 92,
        borderRadius: 46,
        backgroundColor: OG_COLORS.greenDim,
        color: OG_COLORS.accent,
        alignItems: "center",
        justifyContent: "center",
        fontSize: 48,
        fontWeight: 600,
      },
    },
    initial,
  );
}

function statusTag(data: TokenOgData): OgElement {
  const label = data.graduated
    ? "GRADUATED"
    : data.status === "graduating"
      ? "GRADUATING"
      : "BONDING";
  const color = data.graduated
    ? OG_COLORS.accent
    : data.status === "graduating"
      ? OG_COLORS.purple
      : OG_COLORS.buy;
  return h(
    "div",
    {
      style: {
        display: "flex",
        alignItems: "center",
        fontSize: 22,
        fontWeight: 600,
        letterSpacing: "0.1em",
        color,
        border: `1px solid ${color}`,
        padding: "8px 20px",
      },
    },
    label,
  );
}

/**
 * Mini candle chart. Maps the price series to bar heights [22%..96%]; each bar is
 * coloured up/down vs the previous close. All values are indexer-supplied (§2).
 */
function candles(data: TokenOgData): OgElement {
  const bars = candleBars(data.sparkline, CONTENT_W);
  const children: OgChild[] =
    bars.length === 0
      ? [
          h(
            "div",
            {
              style: {
                display: "flex",
                width: "100%",
                height: "100%",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 22,
                color: OG_COLORS.faint,
              },
            },
            "first trades incoming_",
          ),
        ]
      : bars.map((b, i) =>
          h("div", {
            style: {
              display: "flex",
              flex: 1,
              height: `${b.heightPct}%`,
              marginLeft: i === 0 ? 0 : 4,
              backgroundColor: b.up ? OG_COLORS.candleUp : OG_COLORS.candleDown,
            },
          }),
        );
  return h(
    "div",
    {
      style: {
        display: "flex",
        height: CANDLES_H,
        alignItems: "flex-end",
        marginTop: 14,
        width: "100%",
      },
    },
    ...children,
  );
}

function mcap(data: TokenOgData): OgElement {
  return h(
    "div",
    { style: { display: "flex", flexDirection: "column" } },
    h("span", { style: LABEL }, "MCAP"),
    h(
      "div",
      {
        style: {
          display: "flex",
          fontSize: 50,
          fontWeight: 600,
          color: OG_COLORS.text,
          marginTop: 6,
        },
      },
      data.mcapEth ? `${data.mcapEth} ETH` : "—",
    ),
    data.mcapUsd
      ? h(
          "div",
          { style: { display: "flex", fontSize: 20, color: OG_COLORS.muted, marginTop: 4 } },
          `${data.mcapUsd.text} · as of ${shortIso(data.mcapUsd.asOf)}`,
        )
      : null,
  );
}

function graduation(data: TokenOgData, progress: number): OgElement {
  if (data.graduated) {
    return h(
      "div",
      {
        style: {
          display: "flex",
          alignItems: "center",
          fontSize: 24,
          fontWeight: 600,
          letterSpacing: "0.06em",
          color: OG_COLORS.accent,
          border: `1px solid ${OG_COLORS.accent}`,
          padding: "12px 22px",
        },
      },
      "GRADUATED → UNISWAP V3",
    );
  }
  const width = 420;
  return h(
    "div",
    { style: { display: "flex", flexDirection: "column", width, alignItems: "flex-end" } },
    h(
      "div",
      { style: { display: "flex", fontSize: 22, color: OG_COLORS.muted } },
      `${progress.toFixed(1)}% BONDING`,
    ),
    h(
      "div",
      {
        style: {
          display: "flex",
          width,
          height: 14,
          marginTop: 12,
          backgroundColor: OG_COLORS.border,
        },
      },
      h("div", {
        style: {
          display: "flex",
          width: Math.max(6, (width * progress) / 100),
          height: "100%",
          backgroundColor: OG_COLORS.accent,
        },
      }),
    ),
  );
}

/**
 * Normalise a price series to candle bars sized to the chart width. Bar count is
 * capped so wide series stay legible; heights map min..max → 22%..96% so a flat
 * series still shows visible bars.
 */
function candleBars(
  values: number[],
  chartWidth: number,
): { heightPct: number; up: boolean }[] {
  const finite = values.filter((v) => Number.isFinite(v));
  if (finite.length === 0) return [];
  const maxBars = Math.max(8, Math.min(48, Math.floor(chartWidth / 22)));
  const series = finite.length > maxBars ? finite.slice(finite.length - maxBars) : finite;
  const min = Math.min(...series);
  const max = Math.max(...series);
  const span = max - min || 1;
  return series.map((v, i) => {
    const norm = (v - min) / span; // 0..1
    const heightPct = 22 + norm * 74;
    const prev = i === 0 ? v : series[i - 1]!;
    return { heightPct, up: v >= prev };
  });
}

function clampPct(pct: number): number {
  if (!Number.isFinite(pct)) return 0;
  return Math.min(100, Math.max(0, pct));
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/** `2026-07-10T11:12:13Z` → `2026-07-10 11:12` (compact source timestamp). */
function shortIso(iso: string): string {
  const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/.exec(iso);
  return m ? `${m[1]} ${m[2]}` : iso;
}
