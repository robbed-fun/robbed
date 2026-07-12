import {
  api,
  assertIndexed,
  assertOnChain,
  assertUi,
  connectAs,
  expect,
  publicClient,
  routes,
  ROLES,
  seedToken,
  sel,
  test,
  tradeBy,
  tradeFeeLabel,
  tradeIsBuy,
  waitForIndexed,
} from "../harness";

// @flow:TD-2 — Buy pre-grad (curve): optimistic → reconcile · tx type `buy` (§5.2/§2.1)
// assertable-layers: on-chain · indexed · UI
test(
  "TD-2 curve buy renders soft-confirmed then reconciles to indexed truth",
  { tag: ["@flow:TD-2", "@layer:on-chain", "@layer:indexed", "@layer:ui"] },
  async ({ page }) => {
    const token = await seedToken({ name: "Buy Coin", ticker: "BUYC" });
    await page.goto(routes.token(token.token));
    await connectAs(page, "trader");

    await assertUi("buy submits and an optimistic soft-confirmed row appears", async () => {
      await sel.buyTab(page).click();
      await sel.amountInput(page).fill("0.02");
      // Quote rows disclose the curve fee (widget "Fee" row, value from the M0
      // notebook) + min-received after slippage (§5.2). The old /curve fee/i
      // check passed via TrustPanel prose and never asserted the widget.
      await expect(sel.feeRow(page)).toBeVisible();
      await expect(sel.feeRow(page)).toContainText(tradeFeeLabel());
      await expect(sel.minReceivedRow(page)).toBeVisible();
      await sel.submitTrade(page).click();
      // §12.56: the soft-confirmed chip is removed — the optimistic row landing
      // is proven by the feed ROW appearing (never rendered final; §2.1 rule 3).
      await expect(sel.tradeRows(page).first()).toBeVisible({ timeout: 10_000 });
    });

    let indexedTrade: any;
    await assertIndexed("WS/REST reconciles the trade to indexed amounts", async () => {
      const res = await waitForIndexed(
        () => api.trades(token.token, 50),
        (r) =>
          r.trades.some(
            (t: any) => tradeIsBuy(t) && tradeBy(t, ROLES.trader.address),
          ),
        { label: "buy indexed" },
      );
      indexedTrade = res.trades.find(
        (t: any) => tradeIsBuy(t) && tradeBy(t, ROLES.trader.address),
      );
      expect(indexedTrade.txHash).toMatch(/^0x[0-9a-fA-F]{64}$/);
    });

    await assertOnChain("the reconciled tx is a successful curve buy receipt", async () => {
      const receipt = await publicClient.getTransactionReceipt({ hash: indexedTrade.txHash });
      expect(receipt.status).toBe("success");
    });
  },
);
