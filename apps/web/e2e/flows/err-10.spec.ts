import { bondingCurveAbi } from "@robbed/shared/abi";

import {
  assertOnChain,
  assertUi,
  connectAs,
  expect,
  mine,
  pendingTxCount,
  publicClient,
  routes,
  ROLES,
  seedToken,
  sel,
  setAutomine,
  setPauseBuys,
  test,
} from "../harness";

// @flow:ERR-10 — Transaction reverts on-chain (generic) (§5.2)
// assertable-layers: on-chain · UI   (N/A indexed: reverted tx → no Trade — waiver)

// ERR-10 toggles automine + pauseBuys; restore BOTH even on failure so later
// flows are never wedged (seedToken's ensureBuysEnabled is belt+braces).
test.afterEach(async () => {
  await setAutomine(true);
  const h = await setPauseBuys(false);
  await publicClient.waitForTransactionReceipt({ hash: h });
});

test(
  "ERR-10 a generic on-chain revert flips the row to failed (never left as final)",
  { tag: ["@flow:ERR-10", "@layer:on-chain", "@layer:ui"] },
  async ({ page }) => {
    const token = await seedToken({ name: "Revert Coin", ticker: "RVRT" });

    await assertOnChain("graduate() on a non-ready curve reverts (generic cause)", async () => {
      await expect(
        publicClient.simulateContract({
          account: ROLES.trader.address,
          address: token.curve,
          abi: bondingCurveAbi,
          functionName: "graduate",
          args: [],
        }),
      ).rejects.toThrow();
    });

    await assertUi("a REAL reverted receipt turns the pending row into a failed row + tx link", async () => {
      // Sequence a genuine broadcast-then-revert (no receipt mocking — a mocked
      // revert for a tx that actually succeeded is CONTRADICTED by indexed truth
      // and the app rightly reconciles to it, §4):
      //   1. automine OFF; 2. queue owner setPauseBuys(true); 3. the user's buy
      //   broadcasts fine (gas estimate runs on the still-open latest state) and
      //   queues behind it; 4. mine ONE block → pause executes first → the buy
      //   REVERTS in-block → the app's awaited receipt is a real `reverted`.
      await page.goto(routes.token(token.token));
      await connectAs(page, "trader");
      await sel.buyTab(page).click();
      await sel.amountInput(page).fill("0.01");

      await setAutomine(false);
      await setPauseBuys(true); // queued, NOT mined yet (do not await a receipt)
      await sel.submitTrade(page).click();
      // Wait until BOTH txs sit in the pool, then seal them into one block.
      await expect
        .poll(async () => pendingTxCount(), { timeout: 15_000 })
        .toBeGreaterThanOrEqual(2);
      await setAutomine(true); // restores normal mining AND seals the pool
      await mine(1);

      // ConfirmationBadge renders the exact "Failed" label for a reverted
      // receipt; the row keeps its tx link (href …/tx/0x…) for Blockscout
      // inspection. A soft-confirmed row is never left rendered as final.
      await expect(page.getByText(/^Failed$/).first()).toBeVisible({ timeout: 20_000 });
      await expect(page.locator('a[href*="/tx/0x"]').first()).toBeVisible();
    });
  },
);
