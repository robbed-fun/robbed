import type { TokenDetail } from "@robbed/shared";

/**
 * Venue selection for the invisible venue switch (web.md).
 *
 * The engine is chosen by the INDEXED `status` field (`curve | graduating |
 * graduated`, derived per indexer.md) — NEVER a user choice, never a client
 * heuristic. Pure functions so both the TradeWidget (feature) and any status pill
 * read the same rules (proven in tests/venue.test.ts).
 */
export type TokenStatus = TokenDetail["status"];
export type CurveVenue = "curve" | "v3";

/** Post-graduation → Uniswap V3; everything else trades on the curve. */
export function venueForStatus(status: TokenStatus): CurveVenue {
  return status === "graduated" ? "v3" : "curve";
}

/**
 * The `ReadyToGraduate` interstitial : the curve is locked at threshold
 * pending the permissionless `graduate()` — BOTH directions lock. This is a
 * deterministic, permissionlessly-exitable protocol state, NOT a pause;
 * copy must never call it "paused".
 */
export function isGraduatingLock(status: TokenStatus): boolean {
  return status === "graduating";
}

/** True while the token still trades against the bonding curve. */
export function isOnCurve(status: TokenStatus): boolean {
  return status === "curve";
}
