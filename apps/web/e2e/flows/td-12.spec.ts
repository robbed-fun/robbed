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

// @flow:TD-12 — SSR + per-token OG image (viral share unit)
// assertable-layers: indexed · UI   (N/A on-chain: render output, not chain state — waiver)
//
// re-point (RULED 2026-07-12; record: the user-flows.md TD-12 annotation) OG rendering relocated
// web → API — the web route `/t/[address]/opengraph-image` was REMOVED. The two
// legs are now: (web) SSR `generateMetadata` emits `og:image` as the ABSOLUTE
// API URL; (PNG contract) `GET {API_ORIGIN}/v1/og/{address}.png` → 200
// `image/png` 1200×630 for a seeded token, 404 for an unknown one. The e2e
// stack serves the API, so the PNG assertions still run end-to-end against the
// real renderer. `routes.og()` builds the absolute API URL from `STACK.apiUrl`.
test.describe("TD-12", () => {
  test(
    "TD-12 no-JS SSR emits the absolute API og:image; API serves the 1200×630 PNG",
    { tag: ["@flow:TD-12", "@layer:indexed", "@layer:ui"] },
    async ({ browser }) => {
      const token = await seedToken({ name: "Share Coin", ticker: "SHAR" });

      await assertIndexed("summary reachable for SSR + API OG data", async () => {
        await waitForIndexed(
          () => api.token(token.token),
          (t) => Boolean(t?.address),
          { label: "token for OG" },
        );
      });

      await assertUi(
        "SSR og:image is the absolute API URL (no JS); API OG PNG is 1200×630; unknown → 404",
        async () => {
          // (1) Web leg — SSR meaningful without client JS; `og:image` is the
          //     ABSOLUTE API OG URL. Assert the CONTRACT (absolute origin +
          //     `/v1/og/{address}.png` path), not equality with STACK.apiUrl:
          //     the web server's NEXT_PUBLIC_API_BASE_URL may legitimately be a
          //     different alias of the same API (e.g. docker-internal host).
          const noJs = await browser.newContext({ javaScriptEnabled: false });
          const page = await noJs.newPage();
          await page.goto(`${STACK.webUrl}${routes.token(token.token)}`);
          const ogMeta = page.locator('meta[property="og:image"]');
          await expect(ogMeta).toHaveCount(1);
          await expect(ogMeta).toHaveAttribute(
            "content",
            new RegExp(`^https?://.+/v1/og/${token.token.toLowerCase()}\\.png$`, "i"),
          );
          await expect(page.getByText(/SHAR/i).first()).toBeVisible();

          // (2) PNG-contract leg — the API OG endpoint returns a real PNG at
          //     the spec dimensions (routes.og() is already the absolute URL).
          const res = await noJs.request.get(routes.og(token.token));
          expect(res.status()).toBe(200);
          expect(res.headers()["content-type"]).toContain("image/png");
          const buf = await res.body();
          // PNG IHDR width/height live at byte offsets 16..24 (big-endian).
          const width = buf.readUInt32BE(16);
          const height = buf.readUInt32BE(20);
          expect([width, height]).toEqual([1200, 630]);

          // (3) Unknown (valid-shape, never-seeded) token address → 404.
          const unknownAddress = `0x${"0".repeat(39)}1`;
          const missing = await noJs.request.get(routes.og(unknownAddress));
          expect(missing.status()).toBe(404);

          await noJs.close();
        },
      );
    },
  );
});
