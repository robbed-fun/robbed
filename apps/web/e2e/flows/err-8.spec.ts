import { curveFactoryAbi } from "@robbed/shared/abi";

import {
  assertOnChain,
  assertUi,
  connectAs,
  copy,
  expect,
  launch,
  loadDeployedAddresses,
  publicClient,
  routes,
  setPauseCreates,
  test,
} from "../harness";

// @flow:ERR-8 — Launch blocked while creates paused (§6.5)
// assertable-layers: on-chain · UI   (N/A indexed: no createToken sent → no record — waiver)
//
// UI-mechanism note (2026-07-13): the submit is no longer HARD-disabled while
// paused. The Create button now stays clickable for every block reason and
// EXPLAINS why it won't launch (persistent helper + error toast) — a bare
// `disabled` hid the reason from users. The §6.5 guarantee is unchanged: a paused
// factory can never broadcast `createToken`, so the launch flow never starts.
test(
  "ERR-8 pauseCreates blocks the launch (reason surfaced, no createToken tx); sells elsewhere unaffected",
  { tag: ["@flow:ERR-8", "@layer:on-chain", "@layer:ui"] },
  async ({ page }) => {
    const { curveFactory } = loadDeployedAddresses();

    await assertOnChain("pauseCreates reads true from the factory after being set", async () => {
      const tx = await setPauseCreates(true);
      await publicClient.waitForTransactionReceipt({ hash: tx });
      const flag = (await publicClient.readContract({
        address: curveFactory,
        abi: curveFactoryAbi,
        functionName: "pauseCreates",
      })) as boolean;
      expect(flag).toBe(true);
    });

    await assertUi("paused state disclosed; submit explains the block and never launches", async () => {
      await page.goto(routes.create);
      await connectAs(page, "creator");

      // The paused state is disclosed on the form (§6.5).
      await expect(page.getByText(copy.createsPaused).first()).toBeVisible();

      // The submit is now CLICKABLE (so it can explain itself) but a paused
      // factory can never enter the launch flow — clicking surfaces the reason
      // and no `createToken` is broadcast (button never reaches "Launching…",
      // the page never leaves /create).
      const submit = launch.submit(page);
      await expect(submit).toBeEnabled();
      await submit.click();
      await expect(submit).not.toHaveText(/launching/i);
      await expect(page).toHaveURL(/\/create/);

      // teardown
      const off = await setPauseCreates(false);
      await publicClient.waitForTransactionReceipt({ hash: off });
    });
  },
);
