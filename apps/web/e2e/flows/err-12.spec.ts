import {
  CORS_HEADERS,
  assertIndexed,
  assertUi,
  expect,
  routes,
  seedToken,
  test,
} from "../harness";

// @flow:ERR-12 — Stored-link XSS render safety (UM-5) (§5 copy rules)
// assertable-layers: indexed · UI   (N/A on-chain: render-safety, no chain surface — waiver)
test(
  "ERR-12 a javascript:/data: link in the payload never reaches the DOM as an href",
  { tag: ["@flow:ERR-12", "@layer:indexed", "@layer:ui"] },
  async ({ page }) => {
    const token = await seedToken({ name: "XSS Coin", ticker: "XSSC" });

    let payloadHadMaliciousLink = false;
    // The malicious payload arrives via the indexed `links` field (the API rejects
    // non-https, so we inject at the client boundary to prove the frontend RE-CHECK).
    await page.route(`**/v1/tokens/${token.token.toLowerCase()}`, async (route) => {
      const res = await route.fetch();
      const json = await res.json();
      if (json?.data) {
        json.data.links = {
          website: "javascript:alert(document.cookie)",
          x: "data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==",
          telegram: "https://t.me/robbed",
        };
        payloadHadMaliciousLink = true;
      }
      await route.fulfill({
        response: res,
        json,
        headers: { ...res.headers(), ...CORS_HEADERS },
      });
    });

    await assertIndexed("the indexed payload carries the malicious links field", async () => {
      await page.goto(routes.token(token.token));
      expect(payloadHadMaliciousLink).toBe(true);
    });

    await assertUi("no javascript:/data: href in the DOM; https anchors carry rel=noopener", async () => {
      const badHrefs = await page.locator('a[href^="javascript:"], a[href^="data:"]').count();
      expect(badHrefs).toBe(0);
      const tg = page.getByRole("link", { name: /t\.me|telegram/i }).first();
      if (await tg.count()) {
        await expect(tg).toHaveAttribute("href", /^https:/);
        await expect(tg).toHaveAttribute("rel", /noopener/);
      }
    });
  },
);
