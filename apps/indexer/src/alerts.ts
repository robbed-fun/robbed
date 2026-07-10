/**
 * Gate-7 invariant alerts (indexer.md §9.4). Pure decision functions — no I/O —
 * so the handler stays thin and the alert conditions are unit-tested. The
 * handler logs the returned message (delivery = Prometheus/pager per infra
 * choice at M4); these functions only DECIDE, they never gate chain state (§8.4).
 */

export interface Alert {
  /** Stable metric/alert key for routing. */
  key: string;
  /** Human-readable page message. */
  message: string;
}

/**
 * V3 `Collect.recipient` MUST be the treasury (§6.4/§6.6 — LPFeeVault sends fees
 * to a fixed treasury). Any other recipient pages immediately (§9.4). Returns an
 * alert on mismatch, or `null` when it matches / when `treasury` is unconfigured
 * (can't compare — the caller logs a softer "unverifiable" warning instead).
 * Addresses are compared lowercase (stored lowercase throughout).
 */
export function feeRecipientAlert(
  recipient: string,
  treasury: string | undefined,
  ctx: { token: string; txHash: string },
): Alert | null {
  if (!treasury) return null;
  if (recipient.toLowerCase() === treasury.toLowerCase()) return null;
  return {
    key: "fee_collections.recipient_mismatch",
    message:
      `[gate-7] V3 Collect recipient ${recipient} != treasury ${treasury} ` +
      `for token ${ctx.token} (tx ${ctx.txHash}) — PAGE`,
  };
}
