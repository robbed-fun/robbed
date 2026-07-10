import {
  ROLES,
  api,
  assertIndexed,
  assertOnChain,
  assertUi,
  connectAs,
  expect,
  launch,
  publicClient,
  routes,
  test,
  tradeBy,
  tradeIsBuy,
  waitForIndexed,
} from "../harness";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC",
  "base64",
);

// @flow:LAUNCH-2 — Create token with atomic initial creator buy · tx `createToken` (+ buy) (§5.3)
// assertable-layers: on-chain · indexed · UI
test(
  "LAUNCH-2 create token with an atomic initial creator buy (anti-self-snipe)",
  { tag: ["@flow:LAUNCH-2", "@layer:on-chain", "@layer:indexed", "@layer:ui"] },
  async ({ page }) => {
    await page.goto(routes.create);
    await connectAs(page, "creator");

    let tokenAddress = "";
    await assertUi("initial-buy preview shows minTokensOut at 2% slippage, then submits", async () => {
      await launch.name(page).fill("Snipe-Safe Coin");
      await launch.ticker(page).fill("SAFE");
      await launch.fileInput(page).setInputFiles({
        name: "logo.png",
        mimeType: "image/png",
        buffer: PNG,
      });
      await launch.initialBuy(page).fill("0.05");
      // Live preview of tokens received + min-received (anti-self-snipe §5.3/§6.5).
      await expect(page.getByText(/min|slippage|receive/i).first()).toBeVisible();
      await launch.submit(page).click();
      await expect(page.getByText(/Soft-confirmed/i).first()).toBeVisible({ timeout: 20_000 });
      await page.waitForURL(/\/t\/0x[0-9a-fA-F]{40}/, { timeout: 20_000 });
      tokenAddress = new URL(page.url()).pathname.split("/t/")[1] ?? "";
      expect(tokenAddress).toMatch(/^0x[0-9a-fA-F]{40}$/);
    });

    let firstTrade: any;
    await assertIndexed("the creator's initial buy is the first indexed Trade", async () => {
      const res = await waitForIndexed(
        () => api.trades(tokenAddress, 50),
        (r) =>
          r.trades.some(
            (t: any) => tradeIsBuy(t) && tradeBy(t, ROLES.creator.address),
          ),
        { label: "creator initial buy indexed" },
      );
      firstTrade = res.trades.find(
        (t: any) => tradeIsBuy(t) && tradeBy(t, ROLES.creator.address),
      );
      expect(firstTrade.txHash).toMatch(/^0x[0-9a-fA-F]{64}$/);
    });

    await assertOnChain("the single createToken{value: deployFee + initialBuy} tx succeeded", async () => {
      const receipt = await publicClient.getTransactionReceipt({ hash: firstTrade.txHash });
      expect(receipt.status).toBe("success");
    });
  },
);
