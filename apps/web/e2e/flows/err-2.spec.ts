import { routerAbi } from "@robbed/shared/abi";

import {
  assertOnChain,
  assertUi,
  connectAs,
  copy,
  expect,
  chainNow,
  loadDeployedAddresses,
  publicClient,
  routes,
  ROLES,
  seedToken,
  sel,
  test,
} from "../harness";

// @flow:ERR-2 — Deadline expiry (§5.2)
// assertable-layers: on-chain · UI   (N/A indexed: reverted tx → no Trade — waiver)
test(
  "ERR-2 an expired deadline reverts on-chain; the widget recomputes the deadline at submit",
  { tag: ["@flow:ERR-2", "@layer:on-chain", "@layer:ui"] },
  async ({ page }) => {
    const token = await seedToken({ name: "Deadline Coin", ticker: "DDLN" });
    const { router } = loadDeployedAddresses();

    await assertOnChain("a past deadline reverts on the deadline guard", async () => {
      const pastDeadline = BigInt((await chainNow()) - 1);
      await expect(
        publicClient.simulateContract({
          account: ROLES.trader.address,
          address: router,
          abi: routerAbi,
          functionName: "buy",
          args: [token.token, ROLES.trader.address, 0n, pastDeadline],
          value: 10n ** 16n,
        }),
      ).rejects.toThrow();
    });

    await assertUi("a submit with a fresh deadline is never shipped stale", async () => {
      await page.goto(routes.token(token.token));
      await connectAs(page, "trader");
      await sel.buyTab(page).click();
      await sel.amountInput(page).fill("0.01");
      // The §5.2 disclosure ("· deadline 10m") is ALWAYS rendered, so a bare
      // "no deadline text" check can never pass — assert the disclosure exists,
      // then that the submit SUCCEEDS (the deadline was recomputed at submit;
      // a stale one reverts on-chain, as proven above) with no expiry error.
      await expect(page.getByText(/deadline 10m/i).first()).toBeVisible();
      await sel.submitTrade(page).click();
      await expect(page.getByText(copy.softConfirmed).first()).toBeVisible({ timeout: 15_000 });
      await expect(page.getByText(/expired/i)).toHaveCount(0);
    });
  },
);
