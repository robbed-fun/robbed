import {
  ROLES,
  api,
  assertIndexed,
  assertUi,
  expect,
  routes,
  seedToken,
  test,
  waitForHydration,
  waitForIndexed,
} from "../harness";

// @flow:DISC-4 — Search (name / ticker / contract / creator)
// assertable-layers: indexed · UI   (N/A on-chain: pure indexer query — waiver)
test(
  "DISC-4 search returns matches over name/ticker/contract/creator",
  { tag: ["@flow:DISC-4", "@layer:indexed", "@layer:ui"] },
  async ({ page }) => {
    // Seed from trader2 (not the default creator): the dev-seed creator owns
    // dozens of tokens and /v1/search caps at 20 non-recency-ordered results,
    // so a creator-address query could legitimately omit THIS run's token. A
    // near-fresh creator makes the creator-column assertion deterministic.
    const token = await seedToken({ name: "Searchable Coin", ticker: "SRCH", creator: ROLES.trader2 });

    await assertIndexed("pg_trgm search returns the token row", async () => {
      const res = await waitForIndexed(
        () => api.search(token.ticker),
        (r: any) => (r.tokens ?? []).some((t: any) => t.ticker === token.ticker),
        { label: "search hit" },
      );
      expect((res.tokens ?? []).some((t: any) => t.ticker === token.ticker)).toBe(true);
    });

    await assertUi("search box shows the debounced dropdown and Enter navigates", async () => {
      await page.goto(routes.discover);
      // Hydration barrier: a fill before React hydration settles is wiped when
      // the client tree regenerates (see waitForHydration).
      await waitForHydration(page);
      const box = page.getByRole("searchbox").first();
      await box.fill(token.ticker);
      // Results render as buttons inside the popover; wait for the dropdown entry.
      await expect(
        page.getByRole("button").filter({ hasText: new RegExp(token.ticker, "i") }).first(),
      ).toBeVisible({ timeout: 10_000 });
      await box.press("Enter");
      await expect(page).toHaveURL(new RegExp(`/t/${token.token}`, "i"));
    });

    await assertUi("creator deep link /?q=<creator> seeds the header search box", async () => {
      // : the grid's creator filter is retired — a creator click deep
      // links `/?q=<creator>` and the header SearchBox re-seeds from the URL.
      const detail = await api.token(token.token);
      const creator: string = detail?.creator?.address ?? detail?.creator;
      expect(creator).toMatch(/^0x/);
      await page.goto(`${routes.discover}?q=${creator}`);
      const box = page.getByRole("searchbox").first();
      await expect(box).toHaveValue(creator);
      // The seeded query resolves over the creator column (pg_trgm) too.
      await expect(
        page.getByRole("button").filter({ hasText: new RegExp(token.ticker, "i") }).first(),
      ).toBeVisible({ timeout: 10_000 });
    });
  },
);
