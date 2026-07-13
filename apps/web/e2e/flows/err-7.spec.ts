import {
  api,
  assertIndexed,
  assertOnChain,
  assertUi,
  copy,
  crossGraduationThreshold,
  expect,
  pauseKeeper,
  readGraduationEth,
  readReserves,
  restoreKeeper,
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
    test.setTimeout(180_000);
    const token = await seedToken({ name: "Ready Coin", ticker: "RDYG" });
    // The compose keeper would clear the ReadyToGraduate lock within ~1-2 blocks
    // (its whole job) — starve it of gas so the lock this flow ASSERTS persists.
    // Always restored in `finally` so later flows' graduations (GRAD-AUTO/TD-6) work.
    await pauseKeeper();
    try {
      // Cross the threshold but DO NOT call graduate() — the ReadyToGraduate lock
      // (keeper-safe cross; the keeper is starved so it cannot fire graduate()).
      await crossGraduationThreshold(token.token, token.curve);

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
    } finally {
      await restoreKeeper();
    }
  },
);
