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
  tradeIsSell,
  waitForIndexed,
} from "../harness";

// @flow:TD-5 — Post-grad sell (Uniswap V3) · tx `post-grad V3 sell` (§5.2)
// assertable-layers: on-chain · indexed · UI
test(
  "TD-5 post-graduation sell via SwapRouter (user sees ETH out)",
  { tag: ["@flow:TD-5", "@layer:on-chain", "@layer:indexed", "@layer:ui"] },
  async ({ page }) => {
    const token = await seedToken({ name: "V3 Sell Coin", ticker: "V3S" });
    // trader accrues a balance during the graduation-driving buys.
    await graduateToken(token.token, token.curve);

    await page.goto(routes.token(token.token));
    await connectAs(page, "trader");

    await assertUi("V3 sell submits with soft-confirmed optimistic row", async () => {
      await sel.sellTab(page).click();
      await sel.maxButton(page).click();
      await sel.submitTrade(page).click();
      await expect(page.getByText(copy.softConfirmed).first()).toBeVisible({ timeout: 12_000 });
    });

    let indexedTrade: any;
    await assertIndexed("the V3 sell swap is indexed", async () => {
      const res = await waitForIndexed(
        () => api.trades(token.token, 50),
        (r) => r.trades.some((t: any) => tradeIsSell(t)),
        { label: "v3 sell indexed" },
      );
      indexedTrade = res.trades.find((t: any) => tradeIsSell(t));
      expect(indexedTrade.txHash).toMatch(/^0x[0-9a-fA-F]{64}$/);
    });

    await assertOnChain("the V3 sell receipt succeeded on the fork", async () => {
      const receipt = await publicClient.getTransactionReceipt({ hash: indexedTrade.txHash });
      expect(receipt.status).toBe("success");
    });
  },
);
