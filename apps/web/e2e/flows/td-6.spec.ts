import {
  api,
  assertIndexed,
  assertOnChain,
  assertUi,
  copy,
  crossGraduationThreshold,
  expect,
  graduateOnChain,
  publicClient,
  readCurvePhase,
  routes,
  seedToken,
  test,
  waitForIndexed,
  waitForKeeperGraduation,
} from "../harness";

// @flow:TD-6 — Graduation venue switch · tx `graduate()` (§5.2/§12.12)
// assertable-layers: on-chain · indexed · UI
test(
  "TD-6 permissionless graduate() flips the venue via WS with no reload",
  { tag: ["@flow:TD-6", "@layer:on-chain", "@layer:indexed", "@layer:ui"] },
  async ({ page }) => {
    test.setTimeout(180_000);
    const token = await seedToken({ name: "Graduate Coin", ticker: "GRAD" });
    // Cross the threshold (keeper-safe — never buys a curve the keeper already
    // graduated). The compose keeper may fire graduate() the moment this locks.
    await crossGraduationThreshold(token.token, token.curve);

    // Observe the flip live: land on the page around the graduation moment.
    await page.goto(routes.token(token.token));

    let gradHash: `0x${string}`;
    await assertOnChain("permissionless graduate() succeeds on the fork", async () => {
      // Graduation is PERMISSIONLESS: try the manual trigger, but tolerate the
      // compose keeper winning the race (NotReady) — either way a successful
      // `Graduated` must land.
      if ((await readCurvePhase(token.curve)) === "ready") {
        await graduateOnChain(token.curve)
          .then((h) => publicClient.waitForTransactionReceipt({ hash: h }))
          .catch(() => {});
      }
      const ev = await waitForKeeperGraduation(token.curve, token.token, { timeoutMs: 60_000 });
      gradHash = ev.txHash;
      const receipt = await publicClient.getTransactionReceipt({ hash: gradHash });
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
      // V3"). `useLiveTokenDetail` flips the live status on the WS `graduated`
      // signal (no reload); if the keeper graduated before this page rendered,
      // the SSR status is already graduated and the V3 panel renders on first paint.
      await expect(page.getByText(copy.tradingOnV3).first()).toBeVisible({
        timeout: 30_000,
      });
      await expect(page.getByText(copy.graduatingInterstitial)).toHaveCount(0);
    });
  },
);
