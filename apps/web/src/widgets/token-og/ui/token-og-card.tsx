import type { ReactElement } from "react";

import { AMM_TAGLINE, BRAND } from "@/shared/config/copy";
import { OG_COLORS, OG_HEIGHT, OG_WIDTH, sparklineDataUri } from "@/shared/lib/og";

/**
 * The OG card element tree fed to satori (web.md §6). NOT a DOM component — it is
 * never mounted client-side (no client JS in the OG path). All colors come from
 * the mirrored OG palette (`OG_COLORS`) so the token-bypass lint stays clean; the
 * "soft-confirmed trading" tag is the approved AMM framing (§1). Brand: ROBBED_
 * (redesign Phase F); the terminal-skin OG re-art lands with Phase P.
 *
 * satori uses a Flexbox-only layout engine: every container with more than one
 * child sets `display: 'flex'` explicitly. Layout flows top→bottom; the mcap +
 * progress + brand block is pinned to the bottom via `marginTop: 'auto'`.
 */
import type { TokenOgData } from "../api/get-og-data";

const PAD = 48;
const CONTENT_W = OG_WIDTH - PAD * 2;
const SPARK_PAD = 16;
const SPARK_H = 190;
const SPARK_W = CONTENT_W - SPARK_PAD * 2;

export function buildTokenOgCard(data: TokenOgData): ReactElement {
  const first = data.sparkline.at(0);
  const last = data.sparkline.at(-1);
  const up =
    first !== undefined && last !== undefined && data.sparkline.length >= 2 && last >= first;
  const lineColor = up ? OG_COLORS.buy : OG_COLORS.sell;

  const spark = sparklineDataUri(data.sparkline, {
    width: SPARK_W,
    height: SPARK_H,
    stroke: lineColor,
    fill: lineColor,
    strokeWidth: 5,
    padding: 10,
  });

  const progress = clampPct(data.progressPct);

  return (
    <div
      style={{
        width: OG_WIDTH,
        height: OG_HEIGHT,
        display: "flex",
        flexDirection: "column",
        backgroundColor: OG_COLORS.bg,
        color: OG_COLORS.text,
        fontFamily: "Inter",
        padding: PAD,
      }}
    >
      {/* ── Header: logo + name/ticker + status pill ─────────────────────── */}
      <div style={{ display: "flex", alignItems: "center", width: "100%" }}>
        <Logo data={data} />
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            marginLeft: 26,
            flex: 1,
          }}
        >
          <div style={{ display: "flex", fontSize: 50, fontWeight: 700, lineHeight: 1.05 }}>
            {truncate(data.name, 22)}
          </div>
          <div style={{ display: "flex", fontSize: 28, color: OG_COLORS.muted, marginTop: 6 }}>
            {`$${data.ticker}`}
          </div>
        </div>
        <StatusPill data={data} />
      </div>

      {/* ── Sparkline ────────────────────────────────────────────────────── */}
      <div
        style={{
          display: "flex",
          marginTop: 26,
          borderRadius: 16,
          backgroundColor: OG_COLORS.surface,
          border: `1px solid ${OG_COLORS.border}`,
          padding: SPARK_PAD,
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- satori element tree, not DOM */}
        <img src={spark} width={SPARK_W} height={SPARK_H} alt="" />
      </div>

      {/* ── Bottom block: mcap + graduation, then brand — pinned to bottom ── */}
      <div style={{ display: "flex", flexDirection: "column", marginTop: "auto" }}>
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

        {/* ROBBED_ wordmark (redesign Phase F; final OG art re-skin = Phase P). */}
        <div style={{ display: "flex", alignItems: "center", marginTop: 26 }}>
          <div style={{ display: "flex", fontSize: 26, fontWeight: 700, color: OG_COLORS.accent }}>
            {BRAND}
          </div>
          <div style={{ display: "flex", fontSize: 22, color: OG_COLORS.muted, marginLeft: 16 }}>
            {AMM_TAGLINE}
          </div>
        </div>
      </div>
    </div>
  );
}

function Logo({ data }: { data: TokenOgData }): ReactElement {
  if (data.imageDataUri) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- satori element tree
      <img
        src={data.imageDataUri}
        width={118}
        height={118}
        alt=""
        style={{ borderRadius: 18, objectFit: "cover" }}
      />
    );
  }
  const initial = (data.ticker || data.name || "?").charAt(0).toUpperCase();
  return (
    <div
      style={{
        display: "flex",
        width: 118,
        height: 118,
        borderRadius: 18,
        backgroundColor: OG_COLORS.accent,
        color: OG_COLORS.accentForeground,
        alignItems: "center",
        justifyContent: "center",
        fontSize: 60,
        fontWeight: 700,
      }}
    >
      {initial}
    </div>
  );
}

function StatusPill({ data }: { data: TokenOgData }): ReactElement {
  const label = data.graduated
    ? "Graduated"
    : data.status === "graduating"
      ? "Graduating"
      : "Bonding curve";
  const color = data.graduated ? OG_COLORS.buy : OG_COLORS.softConfirmed;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        fontSize: 24,
        fontWeight: 700,
        color,
        border: `2px solid ${color}`,
        borderRadius: 999,
        padding: "8px 22px",
      }}
    >
      {label}
    </div>
  );
}

function Mcap({ data }: { data: TokenOgData }): ReactElement {
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", fontSize: 22, color: OG_COLORS.muted }}>Market cap</div>
      <div style={{ display: "flex", fontSize: 54, fontWeight: 700, marginTop: 4 }}>
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
          fontSize: 28,
          fontWeight: 700,
          color: OG_COLORS.buy,
          border: `2px solid ${OG_COLORS.buy}`,
          borderRadius: 14,
          padding: "12px 24px",
        }}
      >
        Graduated → Uniswap V3
      </div>
    );
  }
  const width = 400;
  return (
    <div style={{ display: "flex", flexDirection: "column", width, alignItems: "flex-end" }}>
      <div style={{ display: "flex", fontSize: 22, color: OG_COLORS.muted }}>
        {`${progress.toFixed(1)}% to graduation`}
      </div>
      <div
        style={{
          display: "flex",
          width,
          height: 18,
          marginTop: 10,
          borderRadius: 999,
          backgroundColor: OG_COLORS.surface2,
          border: `1px solid ${OG_COLORS.border}`,
        }}
      >
        <div
          style={{
            display: "flex",
            width: Math.max(6, (width * progress) / 100),
            height: "100%",
            borderRadius: 999,
            backgroundColor: OG_COLORS.accent,
          }}
        />
      </div>
    </div>
  );
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
