import {
  assertOnChain,
  assertUi,
  buyOnChain,
  copy,
  expect,
  publicClient,
  readReserves,
  routes,
  seedToken,
  isRpcRequest,
  test,
} from "../harness";

// @flow:ERR-13 — Trust-panel RPC read failure (§5.2)
// assertable-layers: on-chain · UI   (N/A indexed: a failed read indexes nothing — waiver)
test(
  "ERR-13 failed live reads show 'on-chain read unavailable' and never substitute cached API values",
  { tag: ["@flow:ERR-13", "@layer:on-chain", "@layer:ui"] },
  async ({ page }) => {
    const token = await seedToken({ name: "RPC Coin", ticker: "RPCF" });
    const buyHash = await buyOnChain({ token: token.token, ethWei: 3n * 10n ** 16n });
    await publicClient.waitForTransactionReceipt({ hash: buyHash });

    await assertOnChain("reserves DO exist on chain (so the UI failure is purely the RPC path)", async () => {
      const { realEth } = await readReserves(token.curve);
      expect(realEth).toBeGreaterThan(0n);
    });

    await assertUi("failing browser eth_call degrades the row to 'read unavailable'", async () => {
      // Fail the browser's on-chain reads only (the API stays up on purpose:
      // its cached reserves must NEVER be substituted, §5.2).
      await page.route(isRpcRequest, async (route) => {
        const body = route.request().postDataJSON?.();
        const calls = Array.isArray(body) ? body : [body];
        if (calls.some((c: any) => c?.method === "eth_call")) {
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
              jsonrpc: "2.0",
              id: calls[0]?.id ?? 1,
              error: { code: -32000, message: "read unavailable" },
            }),
          });
          return;
        }
        await route.fallback();
      });

      await page.goto(routes.token(token.token));
      await expect(page.getByText(copy.rpcUnavailable).first()).toBeVisible({ timeout: 15_000 });
    });
  },
);
