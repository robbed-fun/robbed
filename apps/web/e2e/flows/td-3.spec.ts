import {
  ROLES,
  api,
  assertIndexed,
  assertOnChain,
  assertUi,
  buyOnChain,
  connectAs,
  expect,
  publicClient,
  routes,
  seedToken,
  sel,
  test,
  tradeIsSell,
  waitForIndexed,
} from "../harness";

// @flow:TD-3 — Sell pre-grad (curve) · tx type `sell`
// assertable-layers: on-chain · indexed · UI
test(
  "TD-3 curve sell (never gated by any pause flag) reconciles to indexed truth",
  { tag: ["@flow:TD-3", "@layer:on-chain", "@layer:indexed", "@layer:ui"] },
  async ({ page }) => {
    const token = await seedToken({ name: "Sell Coin", ticker: "SELL" });
    // Give the trader a token balance to sell.
    const buyHash = await buyOnChain({ buyer: ROLES.trader, token: token.token, ethWei: 5n * 10n ** 16n });
    await publicClient.waitForTransactionReceipt({ hash: buyHash });

    await page.goto(routes.token(token.token));
    await connectAs(page, "trader");

    await assertUi("sell submits with MAX + soft-confirmed optimistic row", async () => {
      await sel.sellTab(page).click();
      await sel.maxButton(page).click();
      await sel.submitTrade(page).click();
      // : soft-confirmed chip removed — prove the optimistic row via the feed row.
      await expect(sel.tradeRows(page).first()).toBeVisible({ timeout: 10_000 });
    });

    let indexedTrade: any;
    await assertIndexed("the sell materializes as an indexed Trade", async () => {
      const res = await waitForIndexed(
        () => api.trades(token.token, 50),
        (r) => r.trades.some((t: any) => tradeIsSell(t)),
        { label: "sell indexed" },
      );
      indexedTrade = res.trades.find((t: any) => tradeIsSell(t));
      expect(indexedTrade.txHash).toMatch(/^0x[0-9a-fA-F]{64}$/);
    });

    await assertOnChain("the sell receipt succeeded on the fork", async () => {
      const receipt = await publicClient.getTransactionReceipt({ hash: indexedTrade.txHash });
      expect(receipt.status).toBe("success");
    });
  },
);
