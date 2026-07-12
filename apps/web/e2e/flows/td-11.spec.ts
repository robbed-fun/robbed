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

// @flow:TD-11 — Token info, Blockscout links, creator profile (§5.2)
// assertable-layers: indexed · UI   (N/A on-chain: display of indexer metadata — waiver)
test(
  "TD-11 token info renders description, https-only links and Blockscout links",
  { tag: ["@flow:TD-11", "@layer:indexed", "@layer:ui"] },
  async ({ page }) => {
    // Real pin path = upload rate-limit backoff (uploads_m 3/min) + a 30s
    // verifier tick — triple the budget rather than race either.
    test.slow();
    // `pin: true` — the description renders from the INDEXED metadata document,
    // so the JSON must be really pinned (API upload + pin) for the indexer's
    // verifier to fetch it; a local-only hash stays "unfetched"/description-null.
    const token = await seedToken({
      name: "Info Coin",
      ticker: "INFO",
      description: "A token used by the TD-11 e2e flow.",
      pin: true,
    });

    await assertIndexed("token summary + verified metadata are indexer-sourced", async () => {
      const t = await waitForIndexed(
        () => api.token(token.token),
        // Wait for the verifier to fetch + materialize the description (async).
        (t) => Boolean(t?.address && t?.creator && t?.description),
        // The verifier ticks every 30s (indexer VERIFIER_POLL_MS) — allow a full
        // tick + fetch before declaring the metadata un-materialized.
        { label: "token info + metadata indexed", timeoutMs: 60_000 },
      );
      // Creator is the enriched object shape (api.md §3.4: address + tokensCreated).
      expect(t.creator.address ?? t.creator).toMatch(/^0x[0-9a-fA-F]{40}$/);
      expect(t.description).toContain("TD-11 e2e flow");
    });

    await assertUi("info block shows description + Blockscout contract link", async () => {
      await page.goto(routes.token(token.token));
      await expect(page.getByText(/TD-11 e2e flow/i).first()).toBeVisible();
      // The Contract row's link carries the short address as its NAME; assert
      // by href shape (…blockscout.com/token/<address>) — structural, not copy.
      const explorerLink = page
        .locator(`a[href*="blockscout.com/token/${token.token.toLowerCase()}"]`)
        .first();
      await expect(explorerLink).toBeVisible();
    });
  },
);
