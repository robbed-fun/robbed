import { bondingCurveAbi } from "@robbed/shared/abi";

import {
  assertOnChain,
  assertUi,
  connectAs,
  expect,
  publicClient,
  routes,
  ROLES,
  seedToken,
  sel,
  isRpcRequest,
  test,
} from "../harness";

// @flow:ERR-10 — Transaction reverts on-chain (generic) (§5.2)
// assertable-layers: on-chain · UI   (N/A indexed: reverted tx → no Trade — waiver)
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

    await assertUi("a reverted receipt turns the pending row into a failed row + tx link", async () => {
      // Force the trade's receipt to read `reverted` — the client can't tell a
      // real revert from this and must run its failed-row treatment (§4 rule).
      await page.route(isRpcRequest, async (route) => {
        const body = route.request().postDataJSON?.();
        const calls = Array.isArray(body) ? body : [body];
        const rc = calls.find((c: any) => c?.method === "eth_getTransactionReceipt");
        if (rc) {
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
              jsonrpc: "2.0",
              id: rc.id,
              result: {
                status: "0x0",
                transactionHash: rc.params?.[0],
                blockNumber: "0x1",
                gasUsed: "0x5208",
                logs: [],
                contractAddress: null,
              },
            }),
          });
          return;
        }
        await route.fallback();
      });

      await page.goto(routes.token(token.token));
      await connectAs(page, "trader");
      await sel.buyTab(page).click();
      await sel.amountInput(page).fill("0.01");
      await sel.submitTrade(page).click();
      await expect(page.getByText(/failed|reverted/i).first()).toBeVisible({ timeout: 15_000 });
      // The row's tx affordance is an <a href="…blockscout…/tx/0x…"> whose
      // visible label is the SHORT TRADER ADDRESS — match on the href.
      await expect(page.locator('a[href*="blockscout"][href*="/tx/0x"]').first()).toBeVisible();
    });
  },
);
