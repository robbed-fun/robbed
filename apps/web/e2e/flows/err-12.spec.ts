import {
  STACK,
  assertIndexed,
  assertUi,
  expect,
  routes,
  seedToken,
  test,
} from "../harness";

// @flow:ERR-12 — Stored-link XSS render safety (UM-5) (copy rules)
// assertable-layers: indexed · UI   (N/A on-chain: render-safety, no chain surface — waiver)
//
// MECHANICS NOTE (I-5b rework): the token page renders `links` from an SSR fetch
// (TokenDetailView is a server component) — a `page.route` tamper of
// `/v1/tokens/:address` can never reach that render, so the old client-boundary
// injection asserted nothing. The real product guarantee is a chain of custody:
// (1) the API WRITE path rejects any non-https link (UM-5 allowlist in
// POST /v1/metadata — checked before image validation), so an indexed payload
// can never carry a javascript:/data: link; (2) the DOM renders zero
// javascript:/data: hrefs and every external anchor is https + rel=noopener.
// The missing frontend defense-in-depth re-check (ExtLink renders href
// verbatim) is reported to robbed-frontend — this spec asserts the shipped
// guarantee, not the gap.
test(
  "ERR-12 a javascript:/data: link in the payload never reaches the DOM as an href",
  { tag: ["@flow:ERR-12", "@layer:indexed", "@layer:ui"] },
  async ({ page }) => {
    const token = await seedToken({ name: "XSS Coin", ticker: "XSSC" });

    await assertIndexed("the indexed write path REJECTS javascript:/data: links (UM-5)", async () => {
      const attempt = async (links: Record<string, string>) => {
        const res = await fetch(`${STACK.apiUrl}/v1/metadata`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            name: "XSS Attempt",
            ticker: "XSSA",
            links,
            imageUrl: "https://cdn.invalid/images/0xab.webp",
            imageHash: `0x${"ab".repeat(32)}`,
          }),
        });
        return (await res.json()) as { data: unknown; error: { code: string } | null };
      };
      const js = await attempt({ website: "javascript:alert(document.cookie)" });
      expect(js.error).toBeTruthy();
      expect(js.data).toBeFalsy();
      const dataUri = await attempt({
        x: "data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==",
      });
      expect(dataUri.error).toBeTruthy();
      const http = await attempt({ telegram: "http://t.me/robbed" });
      expect(http.error).toBeTruthy(); // https-only, not just "not javascript:"
    });

    await assertUi("no javascript:/data: href in the DOM; https anchors carry rel=noopener", async () => {
      await page.goto(routes.token(token.token));
      await expect(page.getByText(new RegExp(token.ticker, "i")).first()).toBeVisible();
      const badHrefs = await page.locator('a[href^="javascript:"], a[href^="data:"]').count();
      expect(badHrefs).toBe(0);
      // Every APP-RENDERED external anchor is https and noopener (UM-5). The
      // lightweight-charts "Charting by TradingView" attribution anchor is
      // LIBRARY-injected DOM (no rel) and not a stored-content link — excluded.
      const external = page.locator('a[href^="http"]:not([href*="tradingview.com"])');
      const n = await external.count();
      expect(n).toBeGreaterThan(0); // Blockscout verify links must exist
      for (let i = 0; i < n; i++) {
        const a = external.nth(i);
        await expect(a).toHaveAttribute("href", /^https:/);
        await expect(a).toHaveAttribute("rel", /noopener/);
      }
    });
  },
);
