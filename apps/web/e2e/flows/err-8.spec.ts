import { curveFactoryAbi } from "@robbed/shared/abi";

import {
  assertOnChain,
  assertUi,
  connectAs,
  copy,
  expect,
  loadDeployedAddresses,
  publicClient,
  routes,
  setPauseCreates,
  test,
} from "../harness";

// @flow:ERR-8 — Launch blocked while creates paused (§6.5)
// assertable-layers: on-chain · UI   (N/A indexed: no createToken sent → no record — waiver)
test(
  "ERR-8 pauseCreates disables the launch submit; sells elsewhere are unaffected",
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

    await assertUi("submit is disabled with the exact paused copy; no tx broadcast", async () => {
      await page.goto(routes.create);
      await connectAs(page, "creator");
      await expect(page.getByText(copy.createsPaused).first()).toBeVisible();
      const submit = page.getByRole("button", { name: /launch|create/i }).first();
      await expect(submit).toBeDisabled();

      // teardown
      const off = await setPauseCreates(false);
      await publicClient.waitForTransactionReceipt({ hash: off });
    });
  },
);
