import { assertUi, copy, expect, routes, seedToken, test } from "../harness";

// @flow:TD-7 — Token detail: the surviving LP-destiny must-render floor
//
// RE-SCOPED 2026-07-13 (USER-DIRECTED SafetyStrip removal) — FLAGGED FOR
// ARCHITECT RATIFICATION (robbed-e2e; NOT self-ratified):
//   The token-detail SafetyStrip block is DELETED. Its live curve reserves,
//   graduation progress, ownerless/fixed-supply/metadata-hash ticks and fee row
//   are GONE from /t/[address]. What SURVIVES on token detail is the single
// hard-rule LP sentence, now rendered as a muted footnote inside
//   `TokenInfo` (verbatim, via the shared `LP_DESTINY_COPY` re-export).
//
//   With the live-read surface gone there is no meaningful on-chain leg and no
//   indexed leg left on THIS page — the LP line is a fixed shared constant, not
//   a chain read and not an indexed record. TD-7 therefore re-scopes to a
//   UI-only assertion of the surviving LP floor. The dropped on-chain leg (live
//   `BondingCurve.reserves()`) and the graduation-progress render are NOT lost
//   to the suite: graduation progress is exercised on the Discover surfaces
//   (TrendingCarousel + TokenCard `GraduationProgress`, TD-13/DISC), and the
//   RPC-degradation copy now lives there + on the /create EconomicsPanel.
//
//   LAYER CHANGE: on-chain · indexed · UI  →  UI (on-chain, indexed waived).
// Mirrors how TD-13 was flagged; awaiting robbed-architect ratification.
//
// assertable-layers: UI  (on-chain, indexed waived — see user-flows-waivers.md)
test(
  "TD-7 token detail renders the surviving LP-destiny floor (verbatim shared constant, in TokenInfo)",
  { tag: ["@flow:TD-7", "@layer:ui"] },
  async ({ page }) => {
    const token = await seedToken({ name: "Trust Coin", ticker: "TRST" });

    await assertUi("the LP sentence renders verbatim on /t/[address]", async () => {
      await page.goto(routes.token(token.token));
      // floor: the ONE shared LP sentence must render on token detail.
      // It moved SafetyStrip → TokenInfo but the hard rule is unchanged.
      await expect(page.getByText(copy.lpCopy).first()).toBeVisible();
    });
  },
);
