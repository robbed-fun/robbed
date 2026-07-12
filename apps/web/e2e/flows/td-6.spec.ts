import {
  api,
  assertIndexed,
  assertOnChain,
  assertUi,
  copy,
  expect,
  graduateOnChain,
  publicClient,
  pushCurveTowardGraduation,
  routes,
  seedToken,
  test,
  waitForIndexed,
} from "../harness";

// @flow:TD-6 — Graduation venue switch · tx `graduate()` (§5.2/§12.12)
// assertable-layers: on-chain · indexed · UI
test(
  "TD-6 permissionless graduate() flips the venue via WS with no reload",
  { tag: ["@flow:TD-6", "@layer:on-chain", "@layer:indexed", "@layer:ui"] },
  async ({ page }) => {
    const token = await seedToken({ name: "Graduate Coin", ticker: "GRAD" });
    await pushCurveTowardGraduation(token.token, token.curve, { crossThreshold: true });

    // Observe the flip live: land on the page BEFORE graduate() executes.
    await page.goto(routes.token(token.token));

    let gradHash: `0x${string}`;
    await assertOnChain("permissionless graduate() succeeds on the fork", async () => {
      gradHash = await graduateOnChain(token.curve);
      const receipt = await publicClient.waitForTransactionReceipt({ hash: gradHash });
      expect(receipt.status).toBe("success");
    });

    await assertIndexed("indexer flips token status to graduated", async () => {
      await waitForIndexed(
        () => api.token(token.token),
        (t) => t?.status === "graduated",
        { label: "status graduated" },
      );
    });

    await assertUi("the venue switch appears live (no reload) — widget re-engines to V3", async () => {
      // Shipped post-grad copy (verified DOM 2026-07-12): the status pill reads
      // "GRADUATED → V3" and the trade widget re-engines to the §5.2 invariant
      // "Trading on Uniswap V3". The catalog requires this flip WS-driven with no
      // reload; assert on the trade widget's re-engine signal.
      await expect(page.getByText(copy.tradingOnV3).first()).toBeVisible({
        timeout: 20_000,
      });
    });
  },
);
