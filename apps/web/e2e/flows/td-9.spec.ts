import {
  api,
  assertIndexed,
  assertOnChain,
  assertUi,
  buyOnChain,
  copy,
  expect,
  mine,
  publicClient,
  routes,
  seedToken,
  sel,
  test,
  waitForIndexed,
} from "../harness";

// @flow:TD-9 — Live trade feed: tier upgrades, soft-confirmed CHIP removed
// AMENDED 2026-07-12: removes the visible "Soft-confirmed" chip; the tier
// machinery (reconcile + watermark) is unchanged. A fresh row shows NO
// settlement chip; only posted-to-L1 / finalized surface. Layers unchanged.
// assertable-layers: on-chain · indexed · UI
test(
  "TD-9 trade feed renders the row with no soft-confirmed chip; posted/finalized surface only",
  { tag: ["@flow:TD-9", "@layer:on-chain", "@layer:indexed", "@layer:ui"] },
  async ({ page }) => {
    const token = await seedToken({ name: "Feed Coin", ticker: "FEED" });
    await page.goto(routes.token(token.token));

    const buyHash = await buyOnChain({ token: token.token, ethWei: 2n * 10n ** 16n });

    await assertOnChain("the feeding trade lands on the fork", async () => {
      const receipt = await publicClient.waitForTransactionReceipt({ hash: buyHash });
      expect(receipt.status).toBe("success");
    });

    await assertIndexed("the trade materializes with a confirmation state", async () => {
      await waitForIndexed(
        () => api.tradeByTx(buyHash),
        (t: any) => Boolean(t?.confirmationState ?? t?.confirmation),
        { label: "trade confirmation state" },
      );
    });

    await assertUi("row appears with NO soft-confirmed chip; never unqualified-final", async () => {
      // The trade row lands in the feed (proven by the row, not a chip).
      await expect(sel.tradeRows(page).first()).toBeVisible({ timeout: 15_000 });
      // : the removed "Soft-confirmed" chip must NOT render anywhere.
      await expect(page.getByText(copy.softConfirmed)).toHaveCount(0);
      // Advance the chain so the O(1) watermark can upgrade held rows.
      await mine(5);
      // Posted/finalized may surface once the watermark passes; a soft-confirmed
      // row must never have rendered as a bare "confirmed"/"final".
      await expect(page.getByText(/\bfinal(ized)?\b(?!.*soft)/i)).toHaveCount(0);
    });
  },
);
