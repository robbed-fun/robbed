import {
  ROLES,
  api,
  assertIndexed,
  assertOnChain,
  assertUi,
  buyOnChain,
  connectAs,
  copy,
  expect,
  publicClient,
  routes,
  seedToken,
  sel,
  setPauseBuys,
  test,
  tradeIsSell,
  waitForIndexed,
} from "../harness";

// @flow:ERR-4 — Sell stays open while buys paused
// assertable-layers: on-chain · indexed · UI  (full 3-layer — the sell must be indexed)

// ALWAYS restore pauseBuys=false even if the test fails mid-way, so this flow can
// never leave the global flag set and cascade BuysPaused into other flows' seeds.
test.afterEach(async () => {
  const p = await setPauseBuys(false);
  await publicClient.waitForTransactionReceipt({ hash: p });
});

test(
  "ERR-4 with pauseBuys set, the Buy tab disables but a Sell executes end-to-end",
  { tag: ["@flow:ERR-4", "@layer:on-chain", "@layer:indexed", "@layer:ui"] },
  async ({ page }) => {
    const token = await seedToken({ name: "Pause Coin", ticker: "PAUS" });
    // trader needs a balance to sell.
    const buyHash = await buyOnChain({ buyer: ROLES.trader, token: token.token, ethWei: 5n * 10n ** 16n });
    await publicClient.waitForTransactionReceipt({ hash: buyHash });

    let sellHash: `0x${string}` | undefined;
    await assertOnChain("pauseBuys=true; a Router.sell still succeeds (never gated)", async () => {
      const p = await setPauseBuys(true);
      await publicClient.waitForTransactionReceipt({ hash: p });

      await page.goto(routes.token(token.token));
      await connectAs(page, "trader");
      // Buy tab is gated with the EXACT copy; Sell reads no flag.
      await sel.buyTab(page).click();
      await expect(page.getByText(copy.buyPaused).first()).toBeVisible();

      await sel.sellTab(page).click();
      await sel.maxButton(page).click();
      await sel.submitTrade(page).click();
      // : soft-confirmed chip removed — prove the sell landed via the feed row.
      await expect(sel.tradeRows(page).first()).toBeVisible({ timeout: 15_000 });
    });

    let indexedSell: any;
    await assertIndexed("the sell materializes as a real indexed Trade despite paused buys", async () => {
      const res = await waitForIndexed(
        () => api.trades(token.token, 50),
        (r) => r.trades.some((t: any) => tradeIsSell(t)),
        { label: "sell-while-paused indexed" },
      );
      indexedSell = res.trades.find((t: any) => tradeIsSell(t));
      sellHash = indexedSell.txHash;
      expect(sellHash).toMatch(/^0x[0-9a-fA-F]{64}$/);
    });

    await assertUi("teardown re-enables buys (pause is granular)", async () => {
      const p = await setPauseBuys(false);
      await publicClient.waitForTransactionReceipt({ hash: p });
      expect(sellHash).toBeTruthy();
    });
  },
);
