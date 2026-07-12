import { routerAbi } from "@robbed/shared/abi";

import {
  assertOnChain,
  assertUi,
  connectAs,
  copy,
  expect,
  forkNowSeconds,
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
      const pastDeadline = BigInt((await forkNowSeconds()) - 1); // fork clock, not wall
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
      // The widget recomputes now+10m at submit; a normal submit must NOT fail on
      // the deadline (proving no stale/expired deadline is ever shipped). The
      // positive signal is the soft-confirmed row; the negative is the widget's
      // EXACT deadline-error copy ("Trade deadline expired — refresh the quote."),
      // not a bare /deadline/ (the slippage row's static "· deadline 10m" always
      // matches that).
      await sel.submitTrade(page).click();
      await expect(page.getByText(copy.softConfirmed).first()).toBeVisible({ timeout: 15_000 });
      await expect(page.getByText(/deadline expired/i)).toHaveCount(0);
    });
  },
);
