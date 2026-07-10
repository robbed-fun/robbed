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

// @flow:TD-8 — Organic-flow metrics & funding-cluster grouping (v1.2, advisory) (§5.2/§8.5)
// assertable-layers: indexed · UI   (N/A on-chain by design — waiver; DATA-GAP-1)
test(
  "TD-8 organic-flow metrics render as a RANGE (or estimating) — never a point value",
  { tag: ["@flow:TD-8", "@layer:indexed", "@layer:ui"] },
  async ({ page }) => {
    const token = await seedToken({ name: "Organic Coin", ticker: "ORGN" });

    let detail: any;
    await assertIndexed("token detail carries trust.organic (or null while fresh)", async () => {
      detail = await waitForIndexed(
        () => api.token(token.token),
        (t) => Boolean(t?.address),
        { label: "token detail for organic stats" },
      );
      // DATA-GAP-1: the field may be null (fresh); the shape must exist, not a number.
      expect("trust" in detail || "organic" in detail).toBeTruthy();
    });

    await assertUi("organic-holder estimate is a range/estimating, never false precision", async () => {
      await page.goto(routes.token(token.token));
      const organic = page.getByText(/organic holders|estimating/i).first();
      await expect(organic).toBeVisible();
      // A lone point-value percentage without a range is forbidden framing (§8.5).
      const text = (await organic.textContent()) ?? "";
      expect(/estimating|~?\s*\d+\s*[–-]\s*\d+\s*%/.test(text)).toBe(true);
    });
  },
);
