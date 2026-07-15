import { assertUi, copy, expect, routes, seedToken, test } from "../harness";

// @flow:TD-7 — Token detail: retired LP-destiny disclosure stays off the page
//
// RE-SCOPED 2026-07-14 (USER-DIRECTED D-74):
//   The token-detail SafetyStrip block is deleted, and the LP-destiny sentence
//   that briefly survived as a muted `TokenInfo` footnote is ALSO deleted. The
//   D-14 LP copy still exists as the single shared constant for surfaces that
//   intentionally render it (for example /create), but /t/[address] is no
//   longer one of those surfaces.
//
//   With the live-read surface gone there is no meaningful on-chain leg and no
//   indexed leg left on THIS page. TD-7 therefore re-scopes to a UI-only
//   regression guard: TokenInfo still renders, but the retired LP sentence does
//   not. The LP-copy must-render assertion lives on LAUNCH-3, where the sentence
//   still intentionally appears via the shared constant.
//
// assertable-layers: UI (on-chain, indexed waived — no token-detail chain/indexed surface)
test(
  "TD-7 token detail keeps the retired LP-destiny sentence off /t/[address]",
  { tag: ["@flow:TD-7", "@layer:ui"] },
  async ({ page }) => {
    const token = await seedToken({ name: "Trust Coin", ticker: "TRST" });

    await assertUi("TokenInfo renders but the retired LP sentence does not", async () => {
      await page.goto(routes.token(token.token));
      await expect(page.getByRole("heading", { name: "Token info" })).toBeVisible();
      await expect(page.getByText(copy.lpCopy)).toHaveCount(0);
    });
  },
);
