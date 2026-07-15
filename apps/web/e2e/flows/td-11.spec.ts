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

// @flow:TD-11 — Token info, Blockscout links, creator profile
// assertable-layers: indexed · UI   (N/A on-chain: display of indexer metadata — waiver)
test(
  "TD-11 token info renders description, https-only links and Blockscout links",
  { tag: ["@flow:TD-11", "@layer:indexed", "@layer:ui"] },
  async ({ page }) => {
    // pin: true — the description renders only after the indexer's verifier
    // FETCHES the pinned JSON from object storage (local fake URIs stay
    // "unfetched" and the DTO's description stays null by design).
    const token = await seedToken({
      name: "Info Coin",
      ticker: "INFO",
      description: "A token used by the TD-11 e2e flow.",
      pin: true,
    });

    await assertIndexed("token summary + fetched metadata are indexer-sourced", async () => {
      // The metadata verifier pass runs on a 30s cadence — allow one full
      // cadence plus the fetch before the description can surface. The verifier
      // also works through a QUEUE — after a full-matrix run it holds ~40 earlier
      // tokens, so a fresh token's first pass can take several cadences (observed:
      // back-to-back matrix runs flaked at 90s). Model the busy-verifier case,
      // not just the idle one; the assertions below stay exact.
      test.setTimeout(240_000);
      const t = await waitForIndexed(
        () => api.token(token.token),
        // Wait for the metadata verifier to fetch + surface the description.
        (t) => Boolean(t?.address && t?.creator && t?.description),
        {
          label: "token info + fetched description indexed",
          timeoutMs: 180_000,
          intervalMs: 3_000,
        },
      );
      // The DTO's creator is an OBJECT ({ address, tokensCreated }) — api.md.
      expect(t.creator.address ?? t.creator).toMatch(/^0x[0-9a-fA-F]{40}$/);
      expect(t.description).toContain("TD-11 e2e flow");
    });

    await assertUi("info block shows description + Blockscout contract link", async () => {
      await page.goto(routes.token(token.token));
      await expect(page.getByText(/TD-11 e2e flow/i).first()).toBeVisible();
      // The contract link's visible label is the SHORT ADDRESS — match the href
      // (Blockscout address route, built by the explorer helper).
      const explorerLink = page
        .locator(`a[href*="blockscout"][href*="${token.token.toLowerCase()}"]`)
        .first();
      await expect(explorerLink).toBeVisible();
    });
  },
);
