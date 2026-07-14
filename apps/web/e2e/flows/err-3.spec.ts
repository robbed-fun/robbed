import { routerAbi } from "@robbed/shared/abi";

import {
  assertOnChain,
  assertUi,
  connectAs,
  copy,
  expect,
  txDeadline,
  loadDeployedAddresses,
  publicClient,
  routes,
  ROLES,
  seedToken,
  sel,
  test,
} from "../harness";

// @flow:ERR-3 — Anti-sniper per-tx cap hit (early window)
// assertable-layers: on-chain · UI   (N/A indexed: reverted attempt → no Trade — waiver)
test(
  "ERR-3 an over-cap early buy is prevented in UI and reverts on-chain if forced",
  { tag: ["@flow:ERR-3", "@layer:on-chain", "@layer:ui"] },
  async ({ page }) => {
    // Fresh token: inside EARLY_WINDOW_END, the per-tx cap is enforced.
    const token = await seedToken({ name: "Sniper Coin", ticker: "SNIP" });
    const { router } = loadDeployedAddresses();

    await assertOnChain("a buy above MAX_EARLY_BUY reverts inside the early window", async () => {
      const deadline = await txDeadline();
      // Far above the fork's maxEarlyBuyWei (~0.2 ETH) → cap revert.
      await expect(
        publicClient.simulateContract({
          account: ROLES.trader.address,
          address: router,
          abi: routerAbi,
          functionName: "buy",
          args: [token.token, ROLES.trader.address, 0n, deadline],
          value: 5n * 10n ** 18n,
        }),
      ).rejects.toThrow();
    });

    await assertUi("widget surfaces the early-launch cap to prevent the revert", async () => {
      await page.goto(routes.token(token.token));
      await connectAs(page, "trader");
      await sel.buyTab(page).click();
      await sel.amountInput(page).fill("5");
      await expect(page.getByText(copy.earlyBuyCap).first()).toBeVisible();
    });
  },
);
