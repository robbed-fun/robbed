import {
  api,
  assertIndexed,
  assertOnChain,
  assertUi,
  copy,
  expect,
  pushCurveTowardGraduation,
  readGraduationEth,
  readReserves,
  routes,
  seedToken,
  test,
  waitForIndexed,
} from "../harness";

// @flow:ERR-7 — Graduating-window lock (ReadyToGraduate, §12.12)
// assertable-layers: on-chain · indexed · UI  (full 3-layer)
test(
  "ERR-7 at threshold both sides lock as a deterministic Graduating state (never 'paused')",
  { tag: ["@flow:ERR-7", "@layer:on-chain", "@layer:indexed", "@layer:ui"] },
  async ({ page }) => {
    const token = await seedToken({ name: "Ready Coin", ticker: "RDYG" });
    // Cross the threshold but DO NOT call graduate() — the ReadyToGraduate lock.
    await pushCurveTowardGraduation(token.token, token.curve, { crossThreshold: true });

    await assertOnChain("curve reserves are at/over GRADUATION_ETH (deterministic lock)", async () => {
      const { realEth } = await readReserves(token.curve);
      // Threshold read LIVE from the deployed curve (not the notebook) — immune to
      // the 8.08→7.92 constant move.
      const target = await readGraduationEth(token.curve);
      expect(realEth >= target).toBe(true);
    });

    await assertIndexed("indexer reports status = graduating", async () => {
      await waitForIndexed(
        () => api.token(token.token),
        (t) => t?.status === "graduating",
        { label: "status graduating" },
      );
    });

    await assertUi("two-sided Graduating interstitial; inputs disabled; copy is not 'paused'", async () => {
      await page.goto(routes.token(token.token));
      await expect(page.getByText(copy.graduatingInterstitial).first()).toBeVisible();
      // Deterministic, permissionlessly-exitable state — never described as paused.
      await expect(page.getByText(/paused/i)).toHaveCount(0);
      // Both buy and sell inputs are disabled during the interstitial.
      const inputs = page.getByRole("spinbutton");
      const count = await inputs.count();
      for (let i = 0; i < count; i++) await expect(inputs.nth(i)).toBeDisabled();
    });
  },
);
