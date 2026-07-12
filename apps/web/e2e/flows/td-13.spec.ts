import {
  CORS_HEADERS,
  ROLES,
  antiSniperWindowSeconds,
  api,
  assertIndexed,
  assertUi,
  buyOnChain,
  expect,
  publicClient,
  routes,
  sel,
  seedToken,
  test,
  waitForIndexed,
  warpTime,
} from "../harness";

// @flow:TD-13 — Token-detail tables: server-side sort + keyset pagination (§12.59)
// AUTHORED 2026-07-12 — FLAGGED for architect ratification (NEW flow): the redesign's
// common `DataTable` gives the trade feed + Top Holders tables SERVER-side sort
// (`?sort=&dir=`, never a client re-rank) and keyset pagination over an opaque,
// HMAC-signed forward cursor. TD-9/TD-10 keep their row-CONTENT intent; this flow
// pins the server-driven mechanics directly.
// assertable-layers: indexed · UI   (no on-chain surface — pure indexer read/paging; waiver)
test(
  "TD-13 a header click dispatches server sort (?sort=&dir=); the keyset pager advances over an opaque cursor",
  { tag: ["@flow:TD-13", "@layer:indexed", "@layer:ui"] },
  async ({ page }) => {
    test.setTimeout(120_000);
    const token = await seedToken({ name: "Sortable Coin", ticker: "SORT" });

    // Seed a handful of trades with DISTINCT eth amounts and TWO distinct traders so
    // `amount` and `trader` server-sorts both reorder vs the default (age DESC). Warp
    // past the anti-sniper early-buy cap first; step the clock by 1s between buys so
    // block.timestamp strictly increases (deterministic age order + keyset tiebreak).
    await warpTime(antiSniperWindowSeconds() + 2);
    const amounts = [1n, 5n, 2n, 4n, 3n].map((x) => x * 10n ** 15n); // 0.001 … 0.005 ETH
    const buyers = [ROLES.trader, ROLES.trader2];
    for (const [i, ethWei] of amounts.entries()) {
      const h = await buyOnChain({ buyer: buyers[i % 2]!, token: token.token, ethWei });
      await publicClient.waitForTransactionReceipt({ hash: h });
      await warpTime(1);
    }

    await assertIndexed(
      "server applies the ?sort=&dir= allowlist (order changes) + keyset-paginates over an opaque cursor",
      async () => {
        await waitForIndexed(
          () => api.trades(token.token, 50),
          (r) => r.trades.length >= amounts.length,
          { label: "seeded trades indexed" },
        );

        // DEFAULT order = age DESC (newest first).
        const def = await api.tradesPage(token.token, { limit: 50 });
        const defOrder = def.items.map((t: any) => t.id);

        // `?sort=amount&dir=asc` is SERVER-sorted: ethAmount is non-decreasing AND the
        // order differs from the default — proving the server ORDER BY, not a client
        // re-rank or the default window.
        const asc = await api.tradesPage(token.token, { sort: "amount", dir: "asc", limit: 50 });
        const eth = asc.items.map((t: any) => BigInt(t.ethAmount));
        for (let i = 1; i < eth.length; i++) {
          expect(eth[i]! >= eth[i - 1]!).toBe(true);
        }
        expect(asc.items.map((t: any) => t.id)).not.toEqual(defOrder);

        // KEYSET pagination: a small limit yields a signed opaque `nextCursor`; page 2
        // is DISJOINT from page 1 and continues the ascending order across the seam.
        const p1 = await api.tradesPage(token.token, { sort: "amount", dir: "asc", limit: 2 });
        expect(typeof p1.nextCursor).toBe("string");
        expect((p1.nextCursor ?? "").length).toBeGreaterThan(0);
        const p2 = await api.tradesPage(token.token, {
          sort: "amount",
          dir: "asc",
          limit: 2,
          cursor: p1.nextCursor!,
        });
        const seen = new Set(p1.items.map((t: any) => t.id));
        expect(p2.items.every((t: any) => !seen.has(t.id))).toBe(true);
        const lastP1 = BigInt(p1.items[p1.items.length - 1].ethAmount);
        expect(BigInt(p2.items[0].ethAmount) >= lastP1).toBe(true);
      },
    );

    await assertUi(
      "a column header dispatches server sort; Next advances a keyset page carrying the opaque cursor",
      async () => {
        // Shrink the trades page WINDOW to 2 so a REAL server-signed nextCursor exists
        // for the pager WITHOUT seeding 50+ rows — a harness manipulation of the
        // REQUEST window only (the cursor + page 2 are the real API's). `route.fetch`
        // bypasses the fixture's CORS shim, so CORS is re-added here (docs-first:
        // Route.fetch accepts a same-protocol `url` override — playwright.dev, 2026-07-12).
        const isTradesReq = (u: URL) =>
          u.pathname.endsWith(`/tokens/${token.token.toLowerCase()}/trades`);
        await page.route(
          (url) => isTradesReq(url),
          async (route) => {
            const url = new URL(route.request().url());
            if (!url.searchParams.has("cursor")) url.searchParams.set("limit", "2");
            const res = await route.fetch({ url: url.toString() });
            await route.fulfill({ response: res, headers: { ...res.headers(), ...CORS_HEADERS } });
          },
        );

        await page.goto(routes.token(token.token));
        await expect(sel.tradeRows(page).first()).toBeVisible({ timeout: 15_000 });

        // (a) SERVER SORT — clicking the TRADES-only "Trader" header re-requests with
        // `?sort=trader&dir=…` (never a client re-rank); the header carries `aria-sort`.
        const sortReq = page.waitForRequest((req) => {
          const u = new URL(req.url());
          return isTradesReq(u) && u.searchParams.get("sort") === "trader";
        });
        await sel.sortHeader(page, "Trader").click();
        const sr = await sortReq;
        expect(new URL(sr.url()).searchParams.get("dir")).toMatch(/^(asc|desc)$/);
        await expect(sel.sortHeader(page, "Trader")).toHaveAttribute(
          "aria-sort",
          /ascending|descending/,
        );

        // (b) KEYSET PAGER — Next re-requests carrying the OPAQUE `?cursor=` and
        // advances to page 2 (rows change); Prev returns to page 1. Wait for the
        // sorted page-1 fetch to SETTLE (Next enables only once `isFetching` is false
        // AND a `nextCursor` exists) before capturing the page-1 head.
        await expect(sel.pager(page)).toBeVisible();
        await expect(sel.pagerNext(page)).toBeEnabled();
        const firstBefore = await sel.tradeRows(page).first().innerText();
        const nextReq = page.waitForRequest((req) => {
          const u = new URL(req.url());
          return isTradesReq(u) && u.searchParams.has("cursor");
        });
        await sel.pagerNext(page).click();
        const nr = await nextReq;
        expect(new URL(nr.url()).searchParams.get("cursor")).toBeTruthy();
        await expect(sel.pager(page).getByText(/Page 2/i)).toBeVisible();
        await expect
          .poll(async () => sel.tradeRows(page).first().innerText())
          .not.toBe(firstBefore);

        await sel.pagerPrev(page).click();
        await expect(sel.pager(page).getByText(/Page 1/i)).toBeVisible();
      },
    );
  },
);
