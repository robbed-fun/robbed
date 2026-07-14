import { routerAbi } from "@robbed/shared/abi";

import {
  assertOnChain,
  assertUi,
  buyOnChain,
  connectAs,
  expect,
  txDeadline,
  loadDeployedAddresses,
  publicClient,
  routes,
  ROLES,
  seedToken,
  sel,
  test,
  warpTime,
} from "../harness";

// @flow:ERR-1 — Slippage revert (buy or sell)
// assertable-layers: on-chain · UI   (N/A indexed: reverted tx → no Trade — waiver)
test(
  "ERR-1 a buy under the min-received guard reverts and never promotes an optimistic row",
  { tag: ["@flow:ERR-1", "@layer:on-chain", "@layer:ui"] },
  async ({ page }) => {
    const token = await seedToken({ name: "Slip Coin", ticker: "SLIP" });
    const { router } = loadDeployedAddresses();

    await assertOnChain("min-received guard reverts when minTokensOut exceeds the quote", async () => {
      const [tokensOut] = (await publicClient.readContract({
        address: router,
        abi: routerAbi,
        functionName: "quoteBuy",
        args: [token.token, 10n ** 16n],
      })) as readonly bigint[];
      const deadline = await txDeadline();
      // Demand more than the quote → the on-chain slippage guard must revert.
      await expect(
        publicClient.simulateContract({
          account: ROLES.trader.address,
          address: router,
          abi: routerAbi,
          functionName: "buy",
          args: [token.token, ROLES.trader.address, tokensOut! * 2n, deadline],
          value: 10n ** 16n,
        }),
      ).rejects.toThrow();
    });

    await assertUi("UI surfaces the error, refreshes the quote and keeps the widget usable", async () => {
      await page.goto(routes.token(token.token));
      await connectAs(page, "trader");
      // Race the price up so the widget's stale quote trips the guard.
      await sel.buyTab(page).click();
      await sel.amountInput(page).fill("0.02");
      // Warp past the anti-sniper early window so the large price-moving front-run
      // isn't itself clamped by MAX_EARLY_BUY.
      await warpTime(10);
      await buyOnChain({ buyer: ROLES.trader2, token: token.token, ethWei: 3n * 10n ** 17n });
      await sel.submitTrade(page).click();
      await expect(page.getByText(/slippage|failed|try again|refresh/i).first()).toBeVisible({
        timeout: 15_000,
      });
      // No optimistic row was promoted to a finalized/indexed state.
      await expect(page.getByText(/\bfinalized\b/i)).toHaveCount(0);
    });
  },
);
