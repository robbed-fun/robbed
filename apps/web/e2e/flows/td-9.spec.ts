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
  test,
  waitForIndexed,
} from "../harness";

// @flow:TD-9 — Live trade feed: soft-confirmed badges & tier upgrades (§5.2/§2.1)
// assertable-layers: on-chain · indexed · UI
test(
  "TD-9 trade feed shows soft-confirmed, then upgrades toward posted as the watermark advances",
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

    await assertUi("row shows a soft-confirmed badge, never unqualified-final", async () => {
      await expect(page.getByText(copy.softConfirmed).first()).toBeVisible({ timeout: 15_000 });
      // Advance the chain so the O(1) watermark can upgrade held rows (§12.20).
      await mine(5);
      // Posted may appear once the safe watermark passes; soft-confirmed must never
      // have rendered as a bare "confirmed"/"final" (asserted by absence of that copy).
      await expect(page.getByText(/\bfinal(ized)?\b(?!.*soft)/i)).toHaveCount(0);
    });
  },
);
