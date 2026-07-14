/**
 * Assemble the OG card's live data straight from the indexer DB (no HTTP hop —
 * this runs inside the API that owns the read model). Reuses the SAME `toTokenCard`
 * projection the REST API serves, so the share image can never drift from the
 * token page. Every metric is live (: no hardcoded price/mcap/USD; USD carries
 * its `asOf` from the ETH/USD snapshot). Returns `null` for an unknown token so
 * the route answers 404.
 */
import { formatEther } from "viem";
import { createHash } from "node:crypto";
import type { AppDeps } from "../deps";
import { loadProjectionContext } from "../routes/context";
import { toTokenCard } from "../projections/card";
import type { TokenOgData } from "./card";

/** Bump when the card LAYOUT/renderer changes so cached R2 objects invalidate. */
export const OG_RENDERER_VERSION = "1";

/** Candle window feeding the mini sparkline: trailing 12h at 15m buckets (~48). */
const OG_CANDLE_INTERVAL = "15m" as const;
const OG_WINDOW_SECONDS = 12 * 60 * 60;

export interface OgDataResult {
  data: TokenOgData;
  /** Content-version hash of the DISPLAY fields → R2 cache key + ETag. */
  version: string;
}

export async function getTokenOgData(
  deps: AppDeps,
  address: string,
): Promise<OgDataResult | null> {
  const row = await deps.db.getTokenDetailRow(address);
  if (!row) return null;

  const nowMs = deps.now();
  const ctx = await loadProjectionContext(deps);
  // No 24h anchor needed — the card shows no Δ%. Card gives us name/ticker/status/
  // graduated/progress/mcap(ETH wei + USD w/ asOf) from the one shared projection.
  const card = toTokenCard(row, ctx.wm, ctx.ethUsd, nowMs);

  // Sparkline: best-effort. A candles failure degrades to a flat baseline
  // ("first trades incoming"), never a 404 — the token exists, the image renders.
  let sparkline: number[] = [];
  try {
    const to = Math.floor(nowMs / 1000);
    const rows = await deps.db.getCandles({
      token: address,
      interval: OG_CANDLE_INTERVAL,
      from: to - OG_WINDOW_SECONDS,
      to,
      limit: 5000,
    });
    sparkline = rows.map((r) => r.close);
  } catch {
    sparkline = [];
  }

  const imageDataUri = await deps.ogImage(card.imageUrl);

  const mcapEth = formatMcapEth(card.mcapEth);
  const mcapUsd = formatMcapUsd(card.mcap);

  const data: TokenOgData = {
    name: card.name,
    ticker: card.ticker,
    imageDataUri,
    status: card.status,
    graduated: card.graduated,
    progressPct: card.progressPct,
    sparkline,
    mcapEth,
    mcapUsd,
  };

  return { data, version: versionHash(data) };
}

/** mcap ETH (wei decimal string) → 4-sig-digit display; null when unpriced. */
function formatMcapEth(mcapEthWei: string | undefined): string | null {
  const wei = BigInt(mcapEthWei || "0");
  if (wei === 0n) return null;
  return formatEthNumber(Number(formatEther(wei)));
}

/** ETH float → up to 4 significant fractional digits, trailing zeros trimmed. */
function formatEthNumber(eth: number): string {
  if (!Number.isFinite(eth) || eth === 0) return "0";
  const abs = Math.abs(eth);
  const digits = abs >= 1 ? 4 : Math.min(8, 4 + Math.ceil(-Math.log10(abs)));
  return trimZeros(eth.toFixed(digits));
}

function trimZeros(s: string): string {
  return s.includes(".") ? s.replace(/\.?0+$/, "") : s;
}

/**
 * USD mirror with source timestamp. `null` when there is no usable ETH/USD
 * snapshot (ethUsd ≤ 0 ⇒ the epoch-zero placeholder): the card then shows the
 * ETH figure alone rather than fabricating a USD value.
 */
function formatMcapUsd(
  mcap: { usd: string; ethUsd: string; asOf: string },
): { text: string; asOf: string } | null {
  if (Number(mcap.ethUsd) <= 0) return null;
  const usd = Number(mcap.usd);
  if (!Number.isFinite(usd)) return null;
  const maximumFractionDigits = usd >= 1 ? 0 : 4;
  const text = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits,
  }).format(usd);
  return { text, asOf: mcap.asOf };
}

/**
 * Content-addressed cache version over the display fields. Any change to a
 * rendered value (name, mcap, progress, status, a new candle close, the logo, the
 * USD asOf) yields a new hash → a new R2 key → a fresh render. Prefixed with
 * `OG_RENDERER_VERSION` so a card redesign busts every cached object.
 */
function versionHash(d: TokenOgData): string {
  const canon = JSON.stringify([
    OG_RENDERER_VERSION,
    d.name,
    d.ticker,
    d.status,
    d.graduated,
    Math.round(d.progressPct * 10) / 10,
    d.mcapEth,
    d.mcapUsd,
    // Digest the sparkline so a new trade (new candle close) regenerates the card,
    // without keying on the full array length blowing up the string.
    d.sparkline.map((n) => Number(n.toPrecision(6))),
    d.imageDataUri ? sha256Hex(d.imageDataUri).slice(0, 16) : null,
  ]);
  return sha256Hex(canon).slice(0, 24);
}

function sha256Hex(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}
