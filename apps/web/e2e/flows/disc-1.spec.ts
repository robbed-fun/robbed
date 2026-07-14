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

// @flow:DISC-1 — TRENDING carousel + token-card grid: Discover paints
// assertable-layers: on-chain · indexed · UI
//
// D-73 (2026-07-14): the live event tape is RETIRED; the D-70 TokenCard grid is
// the primary browse surface below the carousel (the carousel STAYS). This flow
// asserts the carousel paints the API's volume-weighted ranking AND the grid
// renders those ranked cards in the API's returned order VERBATIM (server-
// authoritative — the client never re-ranks).
//
// DECISION (docs-first, playwright.dev/docs/api/class-testoptions →
// contextOptions, verified 2026-07-12): the carousel is a pure-CSS marquee that
// never yields a stable bounding box, so Playwright's actionability check would
// time out on click. The component honours `prefers-reduced-motion`
// (`motion-reduce:animate-none`), so we emulate it via `contextOptions.
// reducedMotion: "reduce"` — asserting the accessibility contract instead of
// forcing an unstable click.
test.use({ contextOptions: { reducedMotion: "reduce" } });

test(
  "DISC-1 TRENDING carousel paints the API ranking and the grid renders those ranked cards",
  { tag: ["@flow:DISC-1", "@layer:on-chain", "@layer:indexed", "@layer:ui"] },
  async ({ page }) => {
    const token = await seedToken({ name: "Trending Heist", ticker: "HEIST" });

    await assertOnChain("token deployed on the fork", async () => {
      const receipt = await publicClient.getTransactionReceipt({ hash: token.txHash });
      expect(receipt.status).toBe("success");
    });

    await assertIndexed(
      "API serves the volume-weighted TRENDING ranking (API-owned order, family)",
      async () => {
        const list = await waitForIndexed(
          () => api.tokens("?sort=volume24h&filter=all&limit=8"),
          (r) => r.tokens.length > 0,
          { label: "trending list" },
        );
        // The ranking itself is API-computed; the client only renders the
        // returned order — assert the order is volume24h-descending here.
        const vols = list.tokens.map((t) => BigInt(t.volume24h ?? "0"));
        for (let i = 1; i < vols.length; i++) {
          expect(vols[i - 1]! >= vols[i]!).toBe(true);
        }
      },
    );

    await assertUi(
      "carousel paints ranked cards; the grid renders the API order verbatim; rank-1 navigates",
      async () => {
        // The Discover shell revalidates ~5s server-side — reload until the
        // SSR payload includes at least one ranked carousel card.
        await page.goto(routes.discover);
        await expect(async () => {
          await page.reload();
          await expect(
            page.getByRole("region", { name: /trending tokens/i }),
          ).toBeVisible({ timeout: 2_000 });
        }).toPass({ timeout: 20_000 });

        // D-73: the token grid is the browse surface below the carousel (the tape
        // is retired). The grid paints the API's `sort=trending&filter=all` order
        // VERBATIM (server-authoritative — no client re-rank). Each TokenCard is a
        // `role="link"` with `aria-label="<name> (<ticker>)"`; its nested
        // Blockscout/creator anchors carry no aria-label, so `[role="link"]
        // [aria-label]` selects cards only. Retry across the ~5s SSR revalidate
        // window so the SSR cache and a fresh API read converge.
        const grid = page.getByRole("region", { name: /token grid/i });
        await expect(grid).toBeVisible();
        const cards = grid.locator('[role="link"][aria-label]');
        await expect(async () => {
          await page.reload();
          const apiOrder = (
            await api.tokens("?sort=trending&filter=all&limit=48")
          ).tokens.map((t) => `${t.name} (${t.ticker})`);
          expect(apiOrder.length).toBeGreaterThan(0);
          const rendered = await cards.evaluateAll((els) =>
            els.map((e) => e.getAttribute("aria-label") ?? ""),
          );
          expect(rendered).toEqual(apiOrder);
        }).toPass({ timeout: 20_000 });

        // Rank-1 carousel card (aria-label "… — rank 1") links to its detail page.
        const rank1 = page.getByRole("link", { name: /rank 1$/i }).first();
        await expect(rank1).toBeVisible();
        const href = await rank1.getAttribute("href");
        expect(href).toMatch(/^\/t\/0x[0-9a-fA-F]{40}$/);
        await rank1.click();
        await expect(page).toHaveURL(new RegExp(href!, "i"));
      },
    );
  },
);
