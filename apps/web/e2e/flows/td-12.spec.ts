import {
  api,
  assertIndexed,
  assertUi,
  expect,
  routes,
  seedToken,
  STACK,
  test,
  waitForIndexed,
} from "../harness";

// @flow:TD-12 — SSR + per-token OG image (viral share unit) (§5.2/§9)
// assertable-layers: indexed · UI   (N/A on-chain: render output, not chain state — waiver)
test.describe("TD-12", () => {
  test(
    "TD-12 Token Detail SSR is meaningful with no JS and the OG image renders",
    { tag: ["@flow:TD-12", "@layer:indexed", "@layer:ui"] },
    async ({ browser }) => {
      const token = await seedToken({ name: "Share Coin", ticker: "SHAR" });

      await assertIndexed("summary + candles reachable for SSR/OG", async () => {
        await waitForIndexed(
          () => api.token(token.token),
          (t) => Boolean(t?.address),
          { label: "token for OG" },
        );
      });

      await assertUi("SSR HTML carries OG meta with JS disabled; OG PNG is 1200×630", async () => {
        // (1) SSR meaningful without client JS.
        const noJs = await browser.newContext({ javaScriptEnabled: false });
        const page = await noJs.newPage();
        await page.goto(`${STACK.webUrl}${routes.token(token.token)}`);
        await expect(page.locator('meta[property="og:image"]')).toHaveCount(1);
        await expect(page.getByText(/SHAR/i).first()).toBeVisible();
        await noJs.close();

        // (2) OG route returns a real PNG at the spec dimensions.
        const res = await page.request.get(`${STACK.webUrl}${routes.og(token.token)}`);
        expect(res.status()).toBe(200);
        expect(res.headers()["content-type"]).toContain("image/png");
        const buf = await res.body();
        // PNG IHDR width/height live at byte offsets 16..24 (big-endian).
        const width = buf.readUInt32BE(16);
        const height = buf.readUInt32BE(20);
        expect([width, height]).toEqual([1200, 630]);
      });
    },
  );
});
