import type { WebSocketRoute } from "@playwright/test";

import {
  api,
  assertIndexed,
  assertUi,
  buyOnChain,
  copy,
  expect,
  isAppWsUrl,
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

    // The heal (§12.23) only fires on a RE-connect: the client invalidates every
    // live query key on the 2nd+ successful open (ws-client `hasConnectedOnce`).
    // So the socket must (1) genuinely OPEN, (2) DROP, (3) re-open — a first
    // never-opened socket would be an initial connect, not a gap-heal. Phases
    // drive that; the app connects to the WS ORIGIN (no /v1/ws path → host match).
    let phase: "up" | "outage" | "recovered" = "up";
    let liveWs: WebSocketRoute | null = null;
    await page.routeWebSocket(isAppWsUrl, (ws) => {
      if (phase === "outage") {
        ws.close(); // hold the outage: every backoff retry dies here
        return;
      }
      liveWs = ws;
      const server = ws.connectToServer();
      ws.onMessage((m) => server.send(m));
      server.onMessage((m) => ws.send(m));
    });

    await page.goto(routes.token(token.token));

    await assertUi("degraded banner appears once an established socket drops", async () => {
      // Wait for the FIRST socket to be OPEN — every live-status banner clears
      // only at status "open" (LiveStatusBanner returns null), so zero banners =
      // connected. Then drop that live socket to force the reconnect path.
      await expect(page.getByText(/Live updates|Connecting to live/i)).toHaveCount(0, {
        timeout: 20_000,
      });
      phase = "outage";
      await liveWs?.close();
      await expect(page.getByText(copy.degradedBanner).first()).toBeVisible({ timeout: 15_000 });
    });

    // A trade lands DURING the outage — WS won't deliver it (no replay buffer);
    // REST invalidation on reconnect must close the gap.
    const buyHash = await buyOnChain({ token: token.token, ethWei: 2n * 10n ** 16n });
    await publicClient.waitForTransactionReceipt({ hash: buyHash });

    await assertIndexed("REST re-serves the missed trade after reconnect (gap closed)", async () => {
      // Let the indexer materialize the missed trade FIRST (the heal re-serves
      // whatever is indexed; racing the indexer's own lag would be a flake), then
      // end the outage so the client's backoff reconnects and invalidates.
      await waitForIndexed(
        () => api.tradeByTx(buyHash),
        (t: any) => Boolean(t?.txHash),
        { label: "missed trade indexed" },
      );
      phase = "recovered";
      // On reconnect the client re-opens, invalidates all live keys and refetches;
      // the missed trade surfaces in the feed as a real BUY side-badge row.
      await expect(page.getByText(/^BUY$/).first()).toBeVisible({ timeout: 25_000 });
    });
  },
);
