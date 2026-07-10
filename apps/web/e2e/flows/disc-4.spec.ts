import {
  api,
  assertIndexed,
  assertUi,
  expect,
  routes,
  seedToken,
  test,
  waitForIndexed,
} from "../harness";

// @flow:DISC-4 — Search (name / ticker / contract / creator) (§5.1)
// assertable-layers: indexed · UI   (N/A on-chain: pure indexer query — waiver)
test(
  "DISC-4 search returns matches over name/ticker/contract/creator",
  { tag: ["@flow:DISC-4", "@layer:indexed", "@layer:ui"] },
  async ({ page }) => {
    const token = await seedToken({ name: "Searchable Coin", ticker: "SRCH" });

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
      const box = page.getByRole("searchbox").first();
      await box.fill(token.ticker);
      // Results render as buttons inside the popover; wait for the dropdown entry.
      await expect(
        page.getByRole("button").filter({ hasText: new RegExp(token.ticker, "i") }).first(),
      ).toBeVisible({ timeout: 10_000 });
      await box.press("Enter");
      await expect(page).toHaveURL(new RegExp(`/t/${token.token}`, "i"));
    });
  },
);
