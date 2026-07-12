import {
  api,
  assertIndexed,
  assertUi,
  clearMetadataVerification,
  expect,
  injectMaliciousLinks,
  routes,
  seedToken,
  test,
  waitForIndexed,
} from "../harness";

// @flow:ERR-12 — Stored-link XSS render safety (UM-5) (§5 copy rules)
// assertable-layers: indexed · UI   (N/A on-chain: render-safety, no chain surface — waiver)

// The injected malicious row must be removed even on failure, so it never
// pollutes later flows' reads of this token.
let injectedToken: string | null = null;
test.afterEach(async () => {
  if (injectedToken) {
    await clearMetadataVerification(injectedToken);
    injectedToken = null;
  }
});

test(
  "ERR-12 a javascript:/data: link in the payload never reaches the DOM as an href",
  { tag: ["@flow:ERR-12", "@layer:indexed", "@layer:ui"] },
  async ({ page }) => {
    const token = await seedToken({ name: "XSS Coin", ticker: "XSSC" });

    // The token detail is SERVER-rendered (no client fetch to intercept), and
    // every app ingestion path sanitizes links (API rejects non-https; the
    // verifier only stores schema-vetted links). So to exercise the frontend's
    // UM-5 defense-in-depth we place the malicious payload directly on the
    // indexed record the SSR reads — a harness DB manipulation (never a product
    // change), modeling a link that bypassed the upstream guards. A unique https
    // marker link proves the injected links actually reached the render (below).
    const tgMarker = `https://t.me/robbed-${token.token.slice(2, 10)}`;
    const malicious = {
      website: "javascript:alert(document.cookie)",
      x: "data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==",
      telegram: tgMarker,
    };
    injectedToken = token.token;
    await injectMaliciousLinks(token.token, malicious);

    await assertIndexed("the indexed payload carries the malicious links field", async () => {
      const t = await waitForIndexed(
        () => api.token(token.token),
        (t) => Boolean(t?.links?.website?.startsWith("javascript:")),
        { label: "malicious links indexed" },
      );
      expect(t.links.x).toContain("data:");
    });

    await assertUi("no javascript:/data: href in the DOM; https anchors carry rel=noopener", async () => {
      // Token detail SSR is `revalidate: 5` cached — a stale (pre-injection,
      // link-less) render would make this assertion pass VACUOUSLY. Reload past
      // the window until the injected https marker link renders, proving the
      // injected links are actually in the served render before we assert.
      const marker = page.locator(`a[href="${tgMarker}"]`);
      await expect(async () => {
        await page.goto(routes.token(token.token), { waitUntil: "networkidle" });
        await expect(marker.first()).toBeVisible({ timeout: 2_000 });
      }).toPass({ timeout: 25_000 });

      // UM-5: the frontend's https-only allowlist must drop BOTH non-https
      // schemes entirely — neither may render as an anchor href. (React 19
      // neutralizes javascript: to an inert throwing URL, but that still leaves
      // an `href^="javascript:"`; the allowlist must filter it out upstream, and
      // React does NOT neutralize data: at all.)
      await expect(page.locator('a[href^="data:"]')).toHaveCount(0);
      await expect(page.locator('a[href^="javascript:"]')).toHaveCount(0);
      // The legitimate https link renders and is hardened.
      await expect(marker.first()).toHaveAttribute("rel", /noopener/);
    });
  },
);
