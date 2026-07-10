import type { ReactElement } from "react";

import { TAGLINE_TRADE } from "@/shared/config/copy";
import { OG_COLORS, OG_FONT_FAMILY, OG_HEIGHT, OG_WIDTH } from "@/shared/lib/og";

/**
 * The OG card element tree fed to satori (web.md §6). NOT a DOM component — it is
 * never mounted client-side (no client JS in the OG path). All colors come from
 * the mirrored OG palette (`OG_COLORS`) so the token-bypass lint stays clean.
 *
 * ROBBED_ terminal re-art (task A): mono (IBM Plex Mono), the dark ROBBED_ canvas
 * and green accent (values live in `OG_COLORS`), the `ROBBED_` wordmark with its
 * green `_`, square panels, uppercase letter-spaced micro-labels — the terminal
 * language of the app skin. Spec content (§5.2) is unchanged: chart snapshot (mini candles) +
 * mcap + graduation progress. The `rob responsibly_` tagline replaces the old
 * AMM-framing footer; the AMM guarantee is carried by the page copy + alt text.
 *
 * satori uses a Flexbox-only layout engine: every container with more than one
 * child sets `display: 'flex'` explicitly. Layout flows top→bottom; the mcap +
 * progress block is pinned to the bottom via `marginTop: 'auto'`.
 */
import type { TokenOgData } from "../api/get-og-data";

const PAD = 48;
const CONTENT_W = OG_WIDTH - PAD * 2;
// Fixed vertical budget (satori/yoga resolves percentage bar heights only against
// an explicit parent height, not a flex-basis one) so the whole card fits 630px.
const CHART_PANEL_H = 156;
const CANDLES_H = CHART_PANEL_H - 36 /* pad */ - 24 /* label */ - 14 /* gap */;
const LABEL: React.CSSProperties = {
  display: "flex",
  fontSize: 22,
  letterSpacing: "0.14em",
  color: OG_COLORS.faint,
};

export function buildTokenOgCard(data: TokenOgData): ReactElement {
  const progress = clampPct(data.progressPct);

  return (
    <div
      style={{
        width: OG_WIDTH,
        height: OG_HEIGHT,
        display: "flex",
        flexDirection: "column",
        backgroundColor: OG_COLORS.bg,
        color: OG_COLORS.textSecondary,
        fontFamily: OG_FONT_FAMILY,
        padding: PAD,
      }}
    >
      {/* ── Top bar: ROBBED_ wordmark · status ───────────────────────────── */}
      <div style={{ display: "flex", alignItems: "center", width: "100%" }}>
        <Wordmark />
        <div style={{ display: "flex", marginLeft: "auto" }}>
          <StatusTag data={data} />
        </div>
      </div>

      <Hairline marginTop={18} />

      {/* ── Token identity: avatar · NAME TICKER · PRICE ─────────────────── */}
      <div style={{ display: "flex", alignItems: "center", width: "100%", marginTop: 20 }}>
        <Logo data={data} />
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            marginLeft: 26,
            flex: 1,
            minWidth: 0,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              fontSize: 52,
              fontWeight: 600,
              color: OG_COLORS.text,
              lineHeight: 1.05,
            }}
          >
            {truncate(data.name, 20)}
            <span style={{ marginLeft: 16, fontSize: 26, fontWeight: 400, color: OG_COLORS.faint }}>
              {data.ticker.toUpperCase()}
            </span>
          </div>
        </div>
      </div>

      {/* ── Chart snapshot: mini candles (price / ETH) ───────────────────── */}
      <div
        style={{
          display: "flex",
          height: CHART_PANEL_H,
          flexDirection: "column",
          marginTop: 22,
          border: `1px solid ${OG_COLORS.border}`,
          backgroundColor: OG_COLORS.surface,
          padding: 18,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", width: "100%" }}>
          <span style={LABEL}>PRICE / ETH</span>
        </div>
        <Candles data={data} />
      </div>

      {/* ── Bottom: MCAP · graduation ────────────────────────────────────── */}
      <div style={{ display: "flex", flexDirection: "column", marginTop: 22 }}>
        <div
          style={{
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "space-between",
            width: "100%",
          }}
        >
          <Mcap data={data} />
          <Graduation data={data} progress={progress} />
        </div>

        <Hairline marginTop={18} />

        <div style={{ display: "flex", alignItems: "center", marginTop: 14 }}>
          <span style={{ display: "flex", fontSize: 22, color: OG_COLORS.faint }}>
            {`${TAGLINE_TRADE}_`}
          </span>
        </div>
      </div>
    </div>
  );
}

function Wordmark(): ReactElement {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "baseline",
        fontSize: 34,
        fontWeight: 600,
        letterSpacing: "0.12em",
        color: OG_COLORS.text,
      }}
    >
      ROBBED
      <span style={{ color: OG_COLORS.accent }}>_</span>
    </div>
  );
}

function Hairline({ marginTop }: { marginTop: number }): ReactElement {
  return (
    <div style={{ display: "flex", width: "100%", height: 1, backgroundColor: OG_COLORS.border, marginTop }} />
  );
}

function Logo({ data }: { data: TokenOgData }): ReactElement {
  if (data.imageDataUri) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- satori element tree
      <img
        src={data.imageDataUri}
        width={92}
        height={92}
        alt=""
        style={{ borderRadius: 46, objectFit: "cover" }}
      />
    );
  }
  const initial = (data.ticker || data.name || "?").charAt(0).toUpperCase();
  return (
    <div
      style={{
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
      }}
    >
      {initial}
    </div>
  );
}

function StatusTag({ data }: { data: TokenOgData }): ReactElement {
  const label = data.graduated
    ? "GRADUATED"
    : data.status === "graduating"
      ? "GRADUATING"
      : "BONDING";
  const color = data.graduated ? OG_COLORS.accent : data.status === "graduating" ? OG_COLORS.purple : OG_COLORS.buy;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        fontSize: 22,
        fontWeight: 600,
        letterSpacing: "0.1em",
        color,
        border: `1px solid ${color}`,
        padding: "8px 20px",
      }}
    >
      {label}
    </div>
  );
}

/**
 * Mini candle chart (mockup token-detail chart). Maps the price series to bar
 * heights [22%..96%]; each bar is coloured up/down vs the previous close using
 * the terminal candle fills — a "chart snapshot" that reads as candles, not a
 * line. All values are indexer-supplied (§2); no market math is invented here.
 */
function Candles({ data }: { data: TokenOgData }): ReactElement {
  const values = data.sparkline;
  const bars = candleBars(values, CONTENT_W);
  return (
    <div
      style={{
        display: "flex",
        height: CANDLES_H,
        alignItems: "flex-end",
        marginTop: 14,
        width: "100%",
      }}
    >
      {bars.length === 0 ? (
        <div
          style={{
            display: "flex",
            width: "100%",
            height: "100%",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 22,
            color: OG_COLORS.faint,
          }}
        >
          first trades incoming_
        </div>
      ) : (
        bars.map((b, i) => (
          <div
            key={i}
            style={{
              display: "flex",
              flex: 1,
              height: `${b.heightPct}%`,
              marginLeft: i === 0 ? 0 : 4,
              backgroundColor: b.up ? OG_COLORS.candleUp : OG_COLORS.candleDown,
            }}
          />
        ))
      )}
    </div>
  );
}

function Mcap({ data }: { data: TokenOgData }): ReactElement {
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <span style={LABEL}>MCAP</span>
      <div
        style={{
          display: "flex",
          fontSize: 50,
          fontWeight: 600,
          color: OG_COLORS.text,
          marginTop: 6,
        }}
      >
        {data.mcapEth ? `${data.mcapEth} ETH` : "—"}
      </div>
      {data.mcapUsd ? (
        <div style={{ display: "flex", fontSize: 20, color: OG_COLORS.muted, marginTop: 4 }}>
          {`${data.mcapUsd.text} · as of ${shortIso(data.mcapUsd.asOf)}`}
        </div>
      ) : null}
    </div>
  );
}

function Graduation({
  data,
  progress,
}: {
  data: TokenOgData;
  progress: number;
}): ReactElement {
  if (data.graduated) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          fontSize: 24,
          fontWeight: 600,
          letterSpacing: "0.06em",
          color: OG_COLORS.accent,
          border: `1px solid ${OG_COLORS.accent}`,
          padding: "12px 22px",
        }}
      >
        GRADUATED → UNISWAP V3
      </div>
    );
  }
  const width = 420;
  return (
    <div style={{ display: "flex", flexDirection: "column", width, alignItems: "flex-end" }}>
      <div style={{ display: "flex", fontSize: 22, color: OG_COLORS.muted }}>
        {`${progress.toFixed(1)}% BONDING`}
      </div>
      <div
        style={{
          display: "flex",
          width,
          height: 14,
          marginTop: 12,
          backgroundColor: OG_COLORS.border,
        }}
      >
        <div
          style={{
            display: "flex",
            width: Math.max(6, (width * progress) / 100),
            height: "100%",
            backgroundColor: OG_COLORS.accent,
          }}
        />
      </div>
    </div>
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
