/**
 * Trade-fee split presentation (§7 / §12.63). The on-chain trade fee is the SUM
 * of two bps components — the TREASURY portion (`BondingCurve.TRADE_FEE_BPS`,
 * `FactoryConfig.tradeFeeBps`) and the CREATOR portion
 * (`BondingCurve.CREATOR_FEE_BPS`, `FactoryConfig.creatorFeeBps`) — bounded by
 * `MAX_TRADE_FEE_BPS`. Both are read LIVE (never hardcoded, §2); this is pure
 * presentation over whatever the caller read.
 *
 * Single source so the SafetyStrip split and the /create "you earn N%" line can
 * never drift. `null` bps means "not read yet" (caller shows a loading hint).
 */

/** bps → a trimmed percent string: 100 → "1%", 150 → "1.5%", 25 → "0.25%". */
export function formatBpsPercent(bps: number): string {
  const pct = bps / 100;
  return Number.isInteger(pct) ? `${pct}%` : `${pct.toFixed(2).replace(/0+$/, "")}%`;
}

export interface FeeSplit {
  /** Treasury-portion bps (as read). */
  treasuryBps: number;
  /** Creator-portion bps (as read); 0 on a v1/treasury-only token. */
  creatorBps: number;
  /** Total = treasury + creator. */
  totalBps: number;
  hasCreatorShare: boolean;
  treasuryPct: string;
  creatorPct: string;
  totalPct: string;
}

/**
 * Describe the fee split from the two live bps reads, or `null` when either is
 * still unread (caller renders a "fee reading…" hint). `creatorBps` may legitimately
 * be 0 (v1 tokens) — that is NOT "unread"; pass `0`, not `null`, in that case.
 */
export function describeFeeSplit(
  treasuryBps: number | null,
  creatorBps: number | null,
): FeeSplit | null {
  if (treasuryBps === null || creatorBps === null) return null;
  const totalBps = treasuryBps + creatorBps;
  return {
    treasuryBps,
    creatorBps,
    totalBps,
    hasCreatorShare: creatorBps > 0,
    treasuryPct: formatBpsPercent(treasuryBps),
    creatorPct: formatBpsPercent(creatorBps),
    totalPct: formatBpsPercent(totalBps),
  };
}
