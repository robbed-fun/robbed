import {
  ROLES,
  api,
  assertIndexed,
  assertUi,
  buyOnChain,
  connectAs,
  copy,
  expect,
  parseEther,
  portfolio,
  publicClient,
  seedToken,
  test,
  waitForIndexed,
} from "../harness";

// @flow:PORT-2 — Tab switch: ACTIVITY (historical per-address trade slice) (§12.50a / catalog §3b)
// assertable-layers: indexed · UI   (trades' on-chain legs live in the TD flows — waiver)
//
// §12.56 (2026-07-12): the ActivityTab still renders a per-row `ConfirmationBadge`
// from the INDEXED `confirmationState`, but that component now returns NOTHING for
// the soft-confirmed tier — the visible "Soft-confirmed" chip is removed. So a fresh
// indexed trade (soft_confirmed on a local fork) shows NO settlement badge; posted-
// to-L1 / finalized surface only as the §12.20 watermark advances. The assertion
// below is honest to the row's INDEXED tier (no unconditional badge-presence check).
test(
  "PORT-2 ACTIVITY tab renders the per-address TradeRow slice; §12.56 badge is conditional (no soft chip)",
  { tag: ["@flow:PORT-2", "@layer:indexed", "@layer:ui"] },
  async ({ page }) => {
    const subject = ROLES.trader;
    const token = await seedToken({ name: "Port Act", ticker: "PRT2" });
    const buyTx = await buyOnChain({ buyer: subject, token: token.token, ethWei: parseEther("0.015") });
    await publicClient.waitForTransactionReceipt({ hash: buyTx });

    let row: any;
    await assertIndexed("activity returns the SHARED TradeRow shape for the subject's trade", async () => {
      const res = await waitForIndexed(
        () => api.portfolioActivity(subject.address, "?limit=50"),
        (d) => d.activity.some((t) => t.txHash?.toLowerCase() === buyTx.toLowerCase()),
        { label: "subject trade indexed into activity" },
      );
      row = res.activity.find((t) => t.txHash.toLowerCase() === buyTx.toLowerCase());
      // Shared TradeRow shape (api.md §3.4) — no parallel portfolio model.
      expect(row.isBuy).toBe(true);
      expect(row.trader.toLowerCase()).toBe(subject.address.toLowerCase());
      expect(row.token.toLowerCase()).toBe(token.token.toLowerCase());
      expect(["soft_confirmed", "posted_to_l1", "finalized"]).toContain(row.confirmationState);
    });

    await assertUi("ACTIVITY rows render AGE·SIDE·TOKEN·AMOUNT; badge honest to the indexed tier", async () => {
      await page.goto(portfolio.route());
      await connectAs(page, "trader");
      await portfolio.activityTab(page).click();
      // Tab state is view-local — the URL does not change.
      await expect(page).toHaveURL(/\/portfolio(?:\?|$)/);
      await expect(portfolio.activityTab(page)).toHaveAttribute("aria-selected", "true");
      // The subject's trade row: BUY side badge + token cell linking to /t/.
      await expect(portfolio.sideBadges(page).first()).toBeVisible();
      const tokenLink = page.locator(`a[href="/t/${token.token.toLowerCase()}"]`).first();
      await expect(tokenLink).toBeVisible();
      // Amounts are ETH-denominated in the AMOUNT column.
      await expect(page.getByText(/ETH/).first()).toBeVisible();
      // §12.56: the removed "Soft-confirmed" chip must NEVER render, regardless of
      // tier — a not-yet-finalized trade is never shown unqualified-final (§2.1).
      await expect(page.getByText(copy.softConfirmed)).toHaveCount(0);
      // The badge is now CONDITIONAL on the indexed tier: soft-confirmed shows no
      // settlement badge; posted-to-L1 / finalized surface a qualified one. Assert
      // exactly what the row's own INDEXED `confirmationState` (read above) dictates.
      if (row.confirmationState === "posted_to_l1") {
        await expect(page.getByText(copy.postedToL1).first()).toBeVisible();
      } else if (row.confirmationState === "finalized") {
        await expect(page.getByText(/Finalized/i).first()).toBeVisible();
      }
      // (soft_confirmed → only the row + side badge above; no settlement chip.)
    });
  },
);
