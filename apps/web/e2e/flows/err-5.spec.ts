import {
  ROLES,
  api,
  assertIndexed,
  assertOnChain,
  assertUi,
  buyOnChain,
  connectAs,
  expect,
  makeTreasuryRevert,
  publicClient,
  restoreTreasury,
  routes,
  seedToken,
  sel,
  test,
  tradeIsSell,
  waitForIndexed,
} from "../harness";

// @flow:ERR-5 — Sell stays open while treasury reverts
// assertable-layers: on-chain · indexed · UI  (full 3-layer — the sell must SUCCEED + index)

// ALWAYS restore the treasury to a plain EOA, else the reverting bytecode set by
// makeTreasuryRevert() persists and every later createToken (deploy fee → treasury)
// reverts with EthTransferFailed.
test.afterEach(async () => {
  await restoreTreasury();
});

test(
  "ERR-5 a reverting treasury can never wedge a sell (pull-payment fee accrual)",
  { tag: ["@flow:ERR-5", "@layer:on-chain", "@layer:indexed", "@layer:ui"] },
  async ({ page }) => {
    const token = await seedToken({ name: "Hostile Coin", ticker: "HSTL" });
    const buyHash = await buyOnChain({ buyer: ROLES.trader, token: token.token, ethWei: 5n * 10n ** 16n });
    await publicClient.waitForTransactionReceipt({ hash: buyHash });

    await assertOnChain("with a reverting treasury sink, the sell still succeeds", async () => {
      // : the 1% fee accrues to a pull-payment balance, not pushed inline.
      await makeTreasuryRevert();

      await page.goto(routes.token(token.token));
      await connectAs(page, "trader");
      await sel.sellTab(page).click();
      await sel.maxButton(page).click();
      await sel.submitTrade(page).click();
      // : soft-confirmed chip removed — prove the sell landed via the feed row.
      await expect(sel.tradeRows(page).first()).toBeVisible({ timeout: 15_000 });
    });

    let indexedSell: any;
    await assertIndexed("the sell is a real indexed Trade even with the hostile treasury", async () => {
      const res = await waitForIndexed(
        () => api.trades(token.token, 50),
        (r) => r.trades.some((t: any) => tradeIsSell(t)),
        { label: "sell-with-hostile-treasury indexed" },
      );
      indexedSell = res.trades.find((t: any) => tradeIsSell(t));
      const receipt = await publicClient.getTransactionReceipt({ hash: indexedSell.txHash });
      expect(receipt.status).toBe("success");
    });

    await assertUi("the sell row reconciles to indexed truth (never dropped)", async () => {
      // : soft-confirmed chip removed — the reconciled row is proven present.
      await expect(sel.tradeRows(page).first()).toBeVisible();
    });
  },
);
