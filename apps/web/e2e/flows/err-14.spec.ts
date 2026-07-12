import {
  api,
  assertIndexed,
  assertOnChain,
  assertUi,
  connectAs,
  copy,
  expect,
  isWsRequest,
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
//
// §12.56 RE-ANCHOR (2026-07-12): the old anchor — hovering the visible
// "Soft-confirmed" chip to read its "awaiting index" tooltip — is GONE. The chip is
// removed and the soft-confirmed tier renders NO badge, so the awaiting-index note
// (which is only ever APPENDED to a rendered badge's tooltip) has no visible surface
// for a receipt-success-but-unindexed row. The surviving surface is the optimistic
// ROW itself: this flow now proves the row is KEPT (never dropped) across the
// WS-silence window while the browser cannot index it, then REST fills it. The
// tier machinery + never-final-while-soft rule are unchanged (proven in TD-9).
// (Reported to robbed-frontend: the awaiting-index affordance lost its only surface.)
test(
  "ERR-14 receipt-success but WS-silent: the optimistic row is KEPT (never dropped), REST fills it",
  { tag: ["@flow:ERR-14", "@layer:on-chain", "@layer:indexed", "@layer:ui"] },
  async ({ page }) => {
    const token = await seedToken({ name: "Silent Coin", ticker: "SLNT" });

    // Swallow WS `trade` messages so the optimistic row gets no reconcile event
    // (the `confirmations` watermark + every non-trade message still pass through).
    await page.routeWebSocket(isWsRequest, (ws) => {
      const server = ws.connectToServer();
      server.onMessage((message) => {
        const text = typeof message === "string" ? message : message.toString();
        if (!/"type"\s*:\s*"trade"/.test(text)) ws.send(message);
      });
      ws.onMessage((message) => server.send(message));
    });

    // Hold the browser's REST heal (`GET /v1/trades/:txHash`) too, so the optimistic
    // row cannot reconcile until we RELEASE it — modelling the slow-indexer scenario
    // the flow describes. The harness's OWN Node fetches (api.*) are NOT routed, so
    // the backend still indexes the trade while the browser is held.
    let holdRestHeal = true;
    await page.route("**/v1/trades/**", async (route) => {
      if (holdRestHeal) return route.abort();
      return route.fallback();
    });

    await page.goto(routes.token(token.token));
    await connectAs(page, "trader");

    let optimisticSeen = false;
    await assertUi("optimistic row appears and is KEPT through WS silence + held REST heal", async () => {
      await sel.buyTab(page).click();
      await sel.amountInput(page).fill("0.02");
      await sel.submitTrade(page).click();

      // §12.56: the removed "Soft-confirmed" chip is the OLD anchor — a fresh
      // soft-confirmed trade now surfaces as the feed ROW itself (no settlement
      // chip). The optimistic BUY row lands in the live head.
      const optimisticRow = sel.tradeRows(page).first();
      await expect(optimisticRow).toBeVisible({ timeout: 15_000 });
      await expect(optimisticRow.getByText(/^BUY$/)).toBeVisible();
      optimisticSeen = true;

      // The removed chip must never render, and the row must never read
      // unqualified-final while soft-confirmed (§2.1/§12.20) — the never-final-
      // while-soft rule holds trivially now (no chip until an indexed higher tier).
      await expect(page.getByText(copy.softConfirmed)).toHaveCount(0);
      await expect(page.getByText(/\bfinal(ized)?\b(?!.*soft)/i)).toHaveCount(0);

      // The trade DOES index on the backend (harness Node fetch, not routed) while
      // the browser stays WS-silent AND its REST heal is aborted — so the browser
      // CANNOT reconcile. The row must be KEPT the whole time (never silently
      // dropped, invariant 4). Waiting on the backend index is a real signal, not a
      // sleep; the row must remain visible across it.
      await waitForIndexed(
        () => api.trades(token.token, 50),
        (r) => r.trades.some((t: any) => tradeIsBuy(t)),
        { label: "trade indexed on the backend while the browser heal is held" },
      );
      await expect(optimisticRow).toBeVisible();
      await expect(page.getByText(copy.softConfirmed)).toHaveCount(0);

      // Release the heal — the browser's silence-triggered REST poll now fills
      // indexed truth and the row RECONCILES in place, still never dropped.
      holdRestHeal = false;
      await expect(optimisticRow).toBeVisible();
      await expect(page.getByText(copy.softConfirmed)).toHaveCount(0);
    });

    let restTrade: any;
    await assertIndexed("REST poll GET /v1/trades/:txHash fills the indexed truth", async () => {
      // The silent trade still materializes over REST (WS was silent, the endpoint is not).
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
