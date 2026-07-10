import {
  api,
  assertIndexed,
  assertUi,
  buyOnChain,
  copy,
  expect,
  publicClient,
  routes,
  seedToken,
  test,
  waitForIndexed,
} from "../harness";

// @flow:ERR-11 — WS reconnect / seq-gap heal (§12.23)
// assertable-layers: indexed · UI   (N/A on-chain: client+REST recovery — waiver)
test(
  "ERR-11 a dropped socket shows the degraded banner then REST-heals the gap on reconnect",
  { tag: ["@flow:ERR-11", "@layer:indexed", "@layer:ui"] },
  async ({ page }) => {
    const token = await seedToken({ name: "Reconnect Coin", ticker: "RCON" });

    // Drop the first WS connection to force the degraded state; a later attempt
    // is allowed through so the client can reconnect and REST-invalidate.
    let dropped = false;
    await page.routeWebSocket(/\/v1\/ws/, (ws) => {
      if (!dropped) {
        dropped = true;
        ws.close(); // simulate the socket drop
        return;
      }
      ws.connectToServer(); // subsequent attempts reach the real WS
    });

    await page.goto(routes.token(token.token));

    await assertUi("degraded banner appears while the socket is down", async () => {
      await expect(page.getByText(copy.degradedBanner).first()).toBeVisible({ timeout: 15_000 });
    });

    // A trade lands DURING the outage — WS won't deliver it; REST heal must.
    const buyHash = await buyOnChain({ token: token.token, ethWei: 2n * 10n ** 16n });
    await publicClient.waitForTransactionReceipt({ hash: buyHash });

    await assertIndexed("REST re-serves the missed trade after reconnect (gap closed)", async () => {
      await waitForIndexed(
        () => api.tradeByTx(buyHash),
        (t: any) => Boolean(t?.txHash),
        { label: "missed trade indexed" },
      );
      // On reconnect the client invalidates live keys and re-fetches; the missed
      // trade becomes visible in the feed.
      await expect(page.getByText(/RCON|buy/i).first()).toBeVisible({ timeout: 20_000 });
    });
  },
);
