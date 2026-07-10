import {
  api,
  assertIndexed,
  assertOnChain,
  assertUi,
  connectAs,
  copy,
  expect,
  publicClient,
  routes,
  seedToken,
  sel,
  test,
  tradeIsBuy,
  waitForIndexed,
} from "../harness";

// @flow:ERR-14 — WS silence on an optimistic trade (§4.1 rule 5)
// assertable-layers: on-chain · indexed · UI  (full 3-layer)
test(
  "ERR-14 receipt-success but WS-silent: the row is kept, gains 'awaiting index', REST fills it",
  { tag: ["@flow:ERR-14", "@layer:on-chain", "@layer:indexed", "@layer:ui"] },
  async ({ page }) => {
    const token = await seedToken({ name: "Silent Coin", ticker: "SLNT" });

    // Swallow WS `trade` messages so the optimistic row gets no reconcile event.
    await page.routeWebSocket(/\/v1\/ws/, (ws) => {
      const server = ws.connectToServer();
      server.onMessage((message) => {
        const text = typeof message === "string" ? message : message.toString();
        if (!/"type"\s*:\s*"trade"/.test(text)) ws.send(message);
      });
      ws.onMessage((message) => server.send(message));
    });

    await page.goto(routes.token(token.token));
    await connectAs(page, "trader");

    let optimisticSeen = false;
    await assertUi("optimistic row persists and gains the awaiting-index affordance", async () => {
      await sel.buyTab(page).click();
      await sel.amountInput(page).fill("0.02");
      await sel.submitTrade(page).click();
      await expect(page.getByText(copy.softConfirmed).first()).toBeVisible({ timeout: 12_000 });
      optimisticSeen = true;
      // No WS reconcile arrives → the badge gains "awaiting index" (never dropped).
      await expect(page.getByText(copy.awaitingIndex).first()).toBeVisible({ timeout: 20_000 });
    });

    let restTrade: any;
    await assertIndexed("REST poll GET /v1/trades/:txHash fills the indexed truth", async () => {
      // Find the trader's on-chain buy tx via the indexed feed (WS was silent, but
      // the REST endpoint still materializes it).
      const feed = await waitForIndexed(
        () => api.trades(token.token, 50),
        (r) => r.trades.some((t: any) => tradeIsBuy(t)),
        { label: "silent trade eventually indexed" },
      );
      restTrade = feed.trades.find((t: any) => tradeIsBuy(t));
      const byTx = await api.tradeByTx(restTrade.txHash);
      expect(byTx.txHash?.toLowerCase()).toBe(restTrade.txHash.toLowerCase());
    });

    await assertOnChain("the underlying buy receipt is a success (RPC said so)", async () => {
      expect(optimisticSeen).toBe(true);
      const receipt = await publicClient.getTransactionReceipt({ hash: restTrade.txHash });
      expect(receipt.status).toBe("success");
    });
  },
);
