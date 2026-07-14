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

// @flow:DISC-2 — A new launch surfaces in the Discover grid
// assertable-layers: on-chain · indexed · UI
//
// D-73 (2026-07-14): the live event tape is RETIRED, so its WS "slide-in" of a
// new launch is gone. The surviving Discover surface is the D-70 TokenCard grid,
// fed by the `GET /v1/tokens` path. NOTE (views/discover/model/metrics.ts): the
// `global:metrics` sync only PATCHES cards already in the cache by reference — it
// never INSERTS a net-new token — so a freshly launched token surfaces in the
// grid via the tokens REST path (a fresh sort-tab fetch / SSR revalidate), not a
// live in-place insert. This flow asserts that path.
test(
  "DISC-2 a token launched while Discover is open surfaces in the grid",
  { tag: ["@flow:DISC-2", "@layer:on-chain", "@layer:indexed", "@layer:ui"] },
  async ({ page }) => {
    await page.goto(routes.discover);

    // Create the token AFTER the page is live so we prove it surfaces without a
    // hand-navigated fresh page load beyond the grid's own control fetch.
    const token = await seedToken({ name: "Ticker Coin", ticker: "TICK" });

    await assertOnChain("createToken succeeded on the fork", async () => {
      const receipt = await publicClient.getTransactionReceipt({ hash: token.txHash });
      expect(receipt.status).toBe("success");
    });

    await assertIndexed("indexer serves the launch in GET /v1/tokens (the grid's source)", async () => {
      await waitForIndexed(
        () => api.tokens("?sort=newest&filter=all&limit=48"),
        (r) => r.tokens.some((t) => t.address?.toLowerCase() === token.token.toLowerCase()),
        { label: "launch in tokens list" },
      );
    });

    await assertUi("the new token paints as a grid card (Newest) and the card navigates", async () => {
      const grid = page.getByRole("region", { name: /token grid/i });
      await expect(grid).toBeVisible();
      // Newest sort → a client-side `getTokens({ sort: "newest" })` fetch surfaces
      // the just-launched token at the head immediately (no SSR-revalidate wait).
      await grid.getByRole("tab", { name: /^newest$/i }).click();
      // TokenCard is a `role="link"` whose accessible name is "<name> (<ticker>)".
      const card = grid.getByRole("link", { name: `${token.name} (${token.ticker})` });
      await expect(card).toBeVisible({ timeout: 15_000 });
      // Card click → token detail (router.push navigation).
      await card.click();
      await expect(page).toHaveURL(new RegExp(`/t/${token.token}`, "i"));
    });
  },
);
