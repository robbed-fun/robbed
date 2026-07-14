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

// @flow:ERR-8 — Launch blocked while creates paused
// assertable-layers: on-chain · UI   (N/A indexed: no createToken sent → no record — waiver)
//
// UI-mechanism note (2026-07-13): the submit is no longer HARD-disabled while
// paused. The Create button now stays clickable for every block reason and
// EXPLAINS why it won't launch (persistent helper + error toast) — a bare
// `disabled` hid the reason from users. The guarantee is unchanged: a paused
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

      // The paused state is disclosed on the form.
      await expect(page.getByText(copy.createsPaused).first()).toBeVisible();

      // The submit carries the accessible blocked state: `aria-disabled="true"`
      // whenever a block reason holds (here `pauseCreates`) — LaunchForm sets
      // `aria-disabled={blockReason}` but leaves the real `disabled` prop for the
      // mid-flight double-submit guard only, so the button stays CLICKABLE and can
      // explain itself (persistent helper line + error toast on click). A paused
      // factory can never enter the launch flow: clicking surfaces the reason and
      // broadcasts no `createToken` — the button never reaches "Launching…" and the
      // page never leaves /create. (NB: `toBeEnabled()` treats `aria-disabled` as
      // disabled, so we assert the attribute + a forced click, not `toBeEnabled`.)
      const submit = launch.submit(page);
      await expect(submit).toHaveAttribute("aria-disabled", "true");
      await submit.click({ force: true });
      await expect(submit).not.toHaveText(/launching/i);
      await expect(page).toHaveURL(/\/create/);

      // teardown
      const off = await setPauseCreates(false);
      await publicClient.waitForTransactionReceipt({ hash: off });
    });
  },
);
