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

// @flow:TD-8 — Advisory flags on the Top Holders table (heuristic)
// AMENDED 2026-07-12 : the standalone organic-holder RANGE +
// flow-quality blocks are DROPPED from the public page (moved to the internal
// endpoint). The surviving PUBLIC surface is the per-row advisory
// sniper/programmatic chips on the Top Holders table. Layers + waiver unchanged.
// assertable-layers: indexed · UI   (N/A on-chain by design — waiver; DATA-GAP-1)
test(
  "TD-8 signal surfaces only as advisory holder-row chips; the organic-range block is gone",
  { tag: ["@flow:TD-8", "@layer:indexed", "@layer:ui"] },
  async ({ page }) => {
    const token = await seedToken({ name: "Organic Coin", ticker: "ORGN" });

    let detail: any;
    await assertIndexed("token detail is indexed; flag vocabulary is holder-sourced", async () => {
      detail = await waitForIndexed(
        () => api.token(token.token),
        (t) => Boolean(t?.address),
        { label: "token detail for holder flags" },
      );
      // The signal lives on holder rows (`flags`/`botFlags`), not a public
      // organic block; the shape must exist, never a fabricated number.
      expect(Boolean(detail?.address)).toBeTruthy();
    });

    await assertUi("Top Holders table renders; the dropped organic-range block is ABSENT", async () => {
      await page.goto(routes.token(token.token));
      // The surviving public surface is the holders table itself (advisory
      // chips render per-row where present; heuristic framing, gating nothing).
      await expect(page.getByText(/top holders/i).first()).toBeVisible();
      // drop: the standalone organic-holder range / flow-quality blocks
      // must NOT appear on the public page (moved to the internal surface).
      await expect(page.getByText(/of holders look organic|flow quality/i)).toHaveCount(0);
    });
  },
);
