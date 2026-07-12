import {
  assertUi,
  connectAs,
  expect,
  routes,
  seedToken,
  sel,
  isRpcRequest,
  test,
} from "../harness";

// @flow:ERR-9 — Wallet rejects the transaction (§5.2/§5.3)
// assertable-layers: UI   (N/A on-chain/indexed: nothing broadcast — waiver)
test(
  "ERR-9 a rejected signature resets the optimistic row and preserves form/quote state",
  { tag: ["@flow:ERR-9", "@layer:ui"] },
  async ({ page }) => {
    const token = await seedToken({ name: "Reject Coin", ticker: "RJCT" });

    // Simulate an in-wallet rejection: fail eth_sendTransaction with 4001.
    await page.route(isRpcRequest, async (route) => {
      const body = route.request().postDataJSON?.();
      const calls = Array.isArray(body) ? body : [body];
      if (calls.some((c: any) => c?.method === "eth_sendTransaction")) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: calls[0]?.id ?? 1,
            error: { code: 4001, message: "User rejected the request." },
          }),
        });
        return;
      }
      await route.fallback();
    });

    await page.goto(routes.token(token.token));
    await connectAs(page, "trader");

    await assertUi("optimistic row removed with a toast; input value preserved", async () => {
      await sel.buyTab(page).click();
      await sel.amountInput(page).fill("0.02");
      await sel.submitTrade(page).click();
      await expect(page.getByText(/rejected|cancel(l)?ed|declined/i).first()).toBeVisible({
        timeout: 15_000,
      });
      // No stuck pending/soft-confirmed row remains, and the amount is preserved.
      await expect(sel.amountInput(page)).toHaveValue(/0\.02/);
    });
  },
);
