import {
  api,
  assertIndexed,
  assertOnChain,
  assertUi,
  buyOnChain,
  expect,
  publicClient,
  routes,
  seedToken,
  test,
  waitForIndexed,
} from "../harness";

// @flow:TD-1 — Venue-continuous candles: load, interval switch, live patch (§5.2)
// assertable-layers: on-chain · indexed · UI
test(
  "TD-1 candles load as one merged series and switch interval",
  { tag: ["@flow:TD-1", "@layer:on-chain", "@layer:indexed", "@layer:ui"] },
  async ({ page }) => {
    const token = await seedToken({ name: "Candle Coin", ticker: "CNDL" });
    const buyHash = await buyOnChain({ token: token.token, ethWei: 10n ** 16n });

    await assertOnChain("a curve trade lands to seed the first candle", async () => {
      const receipt = await publicClient.waitForTransactionReceipt({ hash: buyHash });
      expect(receipt.status).toBe("success");
    });

    await assertIndexed("candles endpoint returns one merged series", async () => {
      const now = Math.floor(Date.now() / 1000);
      const res = await waitForIndexed(
        () => api.candles(token.token, "1m", now - 3600, now + 60),
        (r) => (r.candles?.length ?? 0) > 0,
        { label: "candles materialized" },
      );
      // Single series, monotonic non-decreasing bucket times (no venue seam).
      const times = res.candles.map((c: any) => Number(c.time ?? c.t));
      const sorted = [...times].sort((a, b) => a - b);
      expect(times).toEqual(sorted);
    });

    await assertUi("chart renders and interval buttons switch", async () => {
      await page.goto(routes.token(token.token));
      await expect(page.getByRole("button", { name: /1m/ }).first()).toBeVisible();
      await page.getByRole("button", { name: /5m/ }).first().click();
      await expect(page.locator("canvas, table.tv-lightweight-charts").first()).toBeVisible();
    });
  },
);
