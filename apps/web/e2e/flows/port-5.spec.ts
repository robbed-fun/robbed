import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

import {
  CORS_HEADERS,
  type DevAccount,
  antiSniperWindowSeconds,
  api,
  assertIndexed,
  assertUi,
  buyOnChain,
  expect,
  parseEther,
  portfolio,
  publicClient,
  seedToken,
  test,
  testClient,
  waitForIndexed,
  warpTime,
} from "../harness";

const PAGE_SIZE = 50; // the UI's fixed cursor page size (views/portfolio queries.ts)

// @flow:PORT-5 — Cursor pagination (load-more) on the list tabs (/ catalog)
// assertable-layers: indexed · UI   (pure indexer-read paging, no chain surface — waiver)
test(
  "PORT-5 ACTIVITY paginates: 50-row page + Load more appends, then the button disappears",
  { tag: ["@flow:PORT-5", "@layer:indexed", "@layer:ui"] },
  async ({ page }) => {
    test.setTimeout(180_000); // 51 seed trades + two indexer waits

    // A FRESH subject wallet (funded via anvil setBalance) so the trade count is
    // exactly ours — the shared roles accumulate foreign trades from other flows.
    const pk = generatePrivateKey();
    const subject: DevAccount = { address: privateKeyToAccount(pk).address, privateKey: pk };
    await testClient.setBalance({ address: subject.address, value: parseEther("10") });

    // Exactly PAGE_SIZE+1 buys → page 1 is full with a non-null cursor and page 2
    // holds a single row, so the final-page disappearance is deterministic.
    const token = await seedToken({ name: "Port Pages", ticker: "PRT5" });
    await warpTime(antiSniperWindowSeconds() + 2); // past the early-buy cap window
    const nonce0 = await publicClient.getTransactionCount({
      address: subject.address,
      blockTag: "pending",
    });
    let lastTx: `0x${string}` = "0x";
    for (let i = 0; i <= PAGE_SIZE; i++) {
      lastTx = await buyOnChain({
        buyer: subject,
        token: token.token,
        ethWei: parseEther("0.002"),
        nonce: nonce0 + i,
      });
    }
    await publicClient.waitForTransactionReceipt({ hash: lastTx });

    let cursor: string | null = null;
    await assertIndexed("page 1 is full with a nextCursor; the cursor page is disjoint", async () => {
      const page1 = await waitForIndexed(
        () => api.portfolioActivity(subject.address, `?limit=${PAGE_SIZE}`),
        (d) => d.activity.length === PAGE_SIZE && d.nextCursor !== null,
        { label: `activity page 1 (${PAGE_SIZE} rows + cursor)`, timeoutMs: 60_000 },
      );
      cursor = page1.nextCursor;
      const page2 = await api.portfolioActivity(
        subject.address,
        `?limit=${PAGE_SIZE}&cursor=${encodeURIComponent(cursor!)}`,
      );
      expect(page2.activity.length).toBeGreaterThanOrEqual(1);
      expect(page2.nextCursor).toBeNull();
      const ids1 = new Set(page1.activity.map((t) => t.id));
      for (const t of page2.activity) expect(ids1.has(t.id)).toBe(false);
    });

    await assertUi("Load more appends the cursor page in place, then disappears", async () => {
      // Delay only the CURSOR page so the "Loading…"/disabled state is observable.
      await page.route(
        (url) => url.pathname.endsWith("/activity") && url.searchParams.has("cursor"),
        async (route) => {
          await new Promise((r) => setTimeout(r, 800));
          const res = await route.fetch();
          await route.fulfill({ response: res, headers: { ...res.headers(), ...CORS_HEADERS } });
        },
      );

      await page.goto(portfolio.route(subject.address)); // Visitor view — subject via ?address=
      await portfolio.activityTab(page).click();
      await expect(portfolio.sideBadges(page)).toHaveCount(PAGE_SIZE);

      // Prior rows keep identity across the append (no re-order jump).
      const firstHrefBefore = await portfolio.tokenLinks(page).first().getAttribute("href");

      const loadMore = portfolio.loadMore(page);
      await expect(loadMore).toBeVisible();
      await loadMore.click();
      // While the delayed cursor fetch is in flight: "Loading…" + disabled.
      await expect(loadMore).toHaveText(/loading…/i);
      await expect(loadMore).toBeDisabled();

      await expect(portfolio.sideBadges(page)).toHaveCount(PAGE_SIZE + 1);
      expect(await portfolio.tokenLinks(page).first().getAttribute("href")).toBe(firstHrefBefore);
      // Final page (nextCursor: null) → the button disappears.
      await expect(loadMore).toHaveCount(0);
    });
  },
);
