import {
  api,
  assertIndexed,
  assertOnChain,
  assertUi,
  expect,
  publicClient,
  routes,
  seedToken,
  test,
  waitForIndexed,
} from "../harness";

// @flow:DISC-3 — Discover grid: view-local sort/filter tabs + card navigation
// assertable-layers: on-chain · indexed · UI
//
// D-73 (2026-07-14): the event tape is RETIRED; its client-side ALL/LAUNCHES/
// TRADES/GRADUATIONS row-filter is replaced by the D-70 token grid's view-local
// sort/filter tabs. These are SERVER-authoritative (`?sort=&filter=` refetch —
// the client paints the returned order verbatim, never a client re-rank). This
// flow exercises the Sort (Newest) + Filter (Graduated/Pre-grad) tabs and card
// navigation; card metrics resolve from indexer aggregates by reference.
test(
  "DISC-3 the Discover grid sorts, filters and navigates",
  { tag: ["@flow:DISC-3", "@layer:on-chain", "@layer:indexed", "@layer:ui"] },
  async ({ page }) => {
    const token = await seedToken({ name: "Grid Runner", ticker: "GRID" });

    await assertOnChain("token exists on the fork", async () => {
      const receipt = await publicClient.getTransactionReceipt({ hash: token.txHash });
      expect(receipt.status).toBe("success");
    });

    await assertIndexed(
      "GET /v1/tokens serves the token with its indexer aggregates (rendered by reference)",
      async () => {
        const list = await waitForIndexed(
          () => api.tokens("?sort=newest&filter=all&limit=48"),
          (r) => r.tokens.some((t) => t.address?.toLowerCase() === token.token.toLowerCase()),
          { label: "token in tokens list" },
        );
        const card = list.tokens.find(
          (t) => t.address?.toLowerCase() === token.token.toLowerCase(),
        );
        // Grid cards resolve mcap / Δ% / status / progress from these indexer
        // aggregates by reference — never client price math, never fabricated
        // (no-market-metrics rule).
        for (const field of [
          "mcapEth",
          "change24hPct",
          "creator",
          "createdAt",
          "status",
          "progressPct",
        ]) {
          expect(card).toHaveProperty(field);
        }
      },
    );

    await assertUi(
      "sort=Newest surfaces it; filter=Graduated hides the pre-grad token; card navigates",
      async () => {
        await page.goto(routes.discover);
        const grid = page.getByRole("region", { name: /token grid/i });
        await expect(grid).toBeVisible();
        // TokenCard accessible name is "<name> (<ticker>)".
        const card = grid.getByRole("link", { name: `${token.name} (${token.ticker})` });

        // SORT — Newest: the just-created token sorts to the head (server-sorted;
        // the client paints the returned order verbatim, never re-ranks).
        await grid.getByRole("tab", { name: /^newest$/i }).click();
        await expect(card).toBeVisible({ timeout: 15_000 });

        // FILTER — Graduated: the pre-grad curve token is server-filtered OUT (the
        // client re-requests `?filter=graduated`; never a client-side moderation).
        // Pre-grad brings it back.
        await grid.getByRole("tab", { name: /^graduated$/i }).click();
        await expect(card).toHaveCount(0);
        await grid.getByRole("tab", { name: /^pre-grad$/i }).click();
        await expect(card).toBeVisible();

        // Card click → token detail.
        await card.click();
        await expect(page).toHaveURL(new RegExp(`/t/${token.token}`, "i"));
      },
    );
  },
);
