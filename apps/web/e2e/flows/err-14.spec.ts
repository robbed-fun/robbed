import {
  STACK,
  api,
  assertIndexed,
  assertOnChain,
  assertUi,
  connectAs,
  copy,
  expect,
  isAppWsUrl,
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
    // The app connects to the WS ORIGIN (no /v1/ws path) — match by host.
    await page.routeWebSocket(isAppWsUrl, (ws) => {
      const server = ws.connectToServer();
      server.onMessage((message) => {
        const text = typeof message === "string" ? message : message.toString();
        if (!/"type"\s*:\s*"trade"/.test(text)) ws.send(message);
      });
      ws.onMessage((message) => server.send(message));
    });

    // ALSO hold the REST heal (`GET /v1/trades/:txHash`) OPEN initially: the
    // "awaiting index" state is otherwise reconciled away by the app's own heal
    // poll the instant it starts, leaving no observable window. HOLD (not abort):
    // an aborted fetch only retries on the next state churn, while a held
    // request resolves the moment we release it — deterministic reconcile.
    let blockHeal = true;
    await page.route(`${STACK.apiUrl}/v1/trades/**`, async (route) => {
      while (blockHeal) await new Promise((r) => setTimeout(r, 250));
      await route.fallback();
    });

    await page.goto(routes.token(token.token));
    await connectAs(page, "trader");

    let optimisticSeen = false;
    await assertUi("optimistic row persists and gains the awaiting-index affordance", async () => {
      await sel.buyTab(page).click();
      await sel.amountInput(page).fill("0.02");
      await sel.submitTrade(page).click();
      const badge = page.getByText(copy.softConfirmed).first();
      await expect(badge).toBeVisible({ timeout: 12_000 });
      optimisticSeen = true;
      // The affordance is the badge's TOOLTIP gaining "Awaiting the indexer —
      // retrying." (ConfirmationBadge awaitingIndex — verified copy) after the
      // 10s WS-silence window; the row itself is KEPT, never dropped.
      await expect(async () => {
        await badge.hover();
        await expect(page.getByText(/Awaiting the indexer/i).first()).toBeVisible({
          timeout: 2_000,
        });
      }).toPass({ timeout: 25_000 });
    });

    let restTrade: any;
    await assertIndexed("REST poll GET /v1/trades/:txHash fills the indexed truth", async () => {
      // The indexer DID materialize the trade all along (only this browser's WS
      // + heal were held down). Read it via the harness API…
      const feed = await waitForIndexed(
        () => api.trades(token.token, 50),
        (r) => r.trades.some((t: any) => tradeIsBuy(t)),
        { label: "silent trade indexed" },
      );
      restTrade = feed.trades.find((t: any) => tradeIsBuy(t));
      const byTx = await api.tradeByTx(restTrade.txHash);
      expect(byTx.txHash?.toLowerCase()).toBe(restTrade.txHash.toLowerCase());
      // …then release the app's heal and prove the row reconciles: the awaiting
      // note leaves the tooltip once the 5s heal poll succeeds (never dropped).
      blockHeal = false;
      const badge = page.getByText(copy.softConfirmed).first();
      await expect(async () => {
        await page.mouse.move(0, 0); // dismiss any open tooltip
        await badge.hover();
        await expect(page.getByText(/Included by the sequencer/i).first()).toBeVisible({
          timeout: 2_000,
        });
        await expect(page.getByText(/Awaiting the indexer/i)).toHaveCount(0, {
          timeout: 2_000,
        });
      }).toPass({ timeout: 20_000 });
    });

    await assertOnChain("the underlying buy receipt is a success (RPC said so)", async () => {
      expect(optimisticSeen).toBe(true);
      const receipt = await publicClient.getTransactionReceipt({ hash: restTrade.txHash });
      expect(receipt.status).toBe("success");
    });
  },
);
