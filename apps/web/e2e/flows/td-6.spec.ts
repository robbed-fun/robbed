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

    await assertUi("the widget re-engines to Uniswap V3 without a reload", async () => {
      // The venue switch the user observes live is the WIDGET flip: the
      // graduating interstitial gives way to the V3 panel ("Trading on Uniswap
      // V3") with NO reload. (The HEADER status pill is server-rendered and
      // only updates on a fresh render — its live WS flip is a gap reported to
      // robbed-frontend; the catalog's "all WS-driven" step is asserted on the
      // widget surface.)
      await expect(page.getByText(copy.tradingOnV3).first()).toBeVisible({
        timeout: 30_000,
      });
      await expect(page.getByText(copy.graduatingInterstitial)).toHaveCount(0);
    });
  },
);
