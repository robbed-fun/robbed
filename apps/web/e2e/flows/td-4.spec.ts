import {
  ROLES,
  api,
  assertIndexed,
  assertOnChain,
  assertUi,
  connectAs,
  copy,
  expect,
  graduateToken,
  publicClient,
  routes,
  seedToken,
  sel,
  test,
  tradeBy,
  tradeIsBuy,
  waitForIndexed,
} from "../harness";

// @flow:TD-4 — Post-grad buy (Uniswap V3, invisible venue switch) · tx `post-grad V3 buy`
// assertable-layers: on-chain · indexed · UI
test(
  "TD-4 post-graduation buy routes to Uniswap V3 as an invisible venue switch",
  { tag: ["@flow:TD-4", "@layer:on-chain", "@layer:indexed", "@layer:ui"] },
  async ({ page }) => {
    const token = await seedToken({ name: "V3 Buy Coin", ticker: "V3B" });
    await graduateToken(token.token, token.curve);

    await page.goto(routes.token(token.token));
    await connectAs(page, "trader");

    await assertUi("same widget, V3 fee footnote, soft-confirmed optimistic row", async () => {
      await sel.buyTab(page).click();
      await sel.amountInput(page).fill("0.03");
      await expect(page.getByText(copy.tradingOnV3).first()).toBeVisible();
      await sel.submitTrade(page).click();
      // : soft-confirmed chip removed — prove the optimistic row via the feed row.
      await expect(sel.tradeRows(page).first()).toBeVisible({ timeout: 12_000 });
    });

    let indexedTrade: any;
    await assertIndexed("the V3 swap is indexed on the merged trade feed", async () => {
      const res = await waitForIndexed(
        () => api.trades(token.token, 50),
        (r) =>
          r.trades.some(
            (t: any) => tradeIsBuy(t) && tradeBy(t, ROLES.trader.address),
          ),
        { label: "v3 buy indexed" },
      );
      indexedTrade = res.trades.find(
        (t: any) => tradeIsBuy(t) && tradeBy(t, ROLES.trader.address),
      );
      expect(indexedTrade.txHash).toMatch(/^0x[0-9a-fA-F]{64}$/);
    });

    await assertOnChain("the SwapRouter exactInputSingle receipt succeeded", async () => {
      const receipt = await publicClient.getTransactionReceipt({ hash: indexedTrade.txHash });
      expect(receipt.status).toBe("success");
    });
  },
);
