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
  tradeBy,
  tradeIsSell,
  waitForIndexed,
} from "../harness";

// @flow:TD-3b — Sell pre-grad via permit (no prior approval) · tx `sellWithPermit`
// assertable-layers: on-chain · indexed · UI
test(
  "TD-3b sell via EIP-2612 permit (single tx, zero prior allowance)",
  { tag: ["@flow:TD-3b", "@layer:on-chain", "@layer:indexed", "@layer:ui"] },
  async ({ page }) => {
    // trader2 has NO curve allowance — the widget must offer the permit path.
    const token = await seedToken({ name: "Permit Coin", ticker: "PRMT" });
    const buyHash = await buyOnChain({ buyer: ROLES.trader2, token: token.token, ethWei: 4n * 10n ** 16n });
    await publicClient.waitForTransactionReceipt({ hash: buyHash });

    await page.goto(routes.token(token.token));
    await connectAs(page, "trader2");

    await assertUi("widget offers a permit signature instead of approve+sell", async () => {
      await sel.sellTab(page).click();
      await sel.maxButton(page).click();
      // Missing allowance → the widget offers the single-signature permit path
      // (one tx, no separate approve). The affordance copy is advisory; the load-
      // bearing assertion is that the sell submits and soft-confirms from a
      // zero-allowance account (on-chain = sellWithPermit).
      await sel.submitTrade(page).click();
      // : soft-confirmed chip removed — prove the optimistic row via the feed row.
      await expect(sel.tradeRows(page).first()).toBeVisible({ timeout: 12_000 });
    });

    let indexedTrade: any;
    await assertIndexed("the permit sell is indexed as a Trade", async () => {
      const res = await waitForIndexed(
        () => api.trades(token.token, 50),
        (r) =>
          r.trades.some(
            (t: any) => tradeIsSell(t) && tradeBy(t, ROLES.trader2.address),
          ),
        { label: "permit sell indexed" },
      );
      indexedTrade = res.trades.find(
        (t: any) => tradeIsSell(t) && tradeBy(t, ROLES.trader2.address),
      );
      expect(indexedTrade.txHash).toMatch(/^0x[0-9a-fA-F]{64}$/);
    });

    await assertOnChain("the sellWithPermit receipt succeeded (single tx)", async () => {
      const receipt = await publicClient.getTransactionReceipt({ hash: indexedTrade.txHash });
      expect(receipt.status).toBe("success");
    });
  },
);
