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

// @flow:DISC-1 — TRENDING carousel + event tape: Discover paints (as
// amended by — the KotH hero / token grid are retired; the shipped
// surface is the TRENDING carousel over the live event tape)
// assertable-layers: on-chain · indexed · UI
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
  "DISC-1 TRENDING carousel paints the API ranking and the event tape is live",
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
      "carousel paints ranked cards over the live tape; rank-1 card navigates",
      async () => {
        // The Discover shell revalidates ~5s server-side — reload until the
        // SSR payload includes at least one ranked card.
        await page.goto(routes.discover);
        await expect(async () => {
          await page.reload();
          await expect(
            page.getByRole("region", { name: /trending tokens/i }),
          ).toBeVisible({ timeout: 2_000 });
        }).toPass({ timeout: 20_000 });

        // Event tape (live surface) renders alongside the carousel.
        await expect(page.getByRole("region", { name: /live event tape/i })).toBeVisible();

        // Rank-1 card (aria-label "… — rank 1") links to its token detail page.
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
