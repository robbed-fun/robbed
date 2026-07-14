import { formatEther } from "viem";

import {
  KEEPER_ADDRESS,
  ROLES,
  api,
  assertIndexed,
  assertOnChain,
  assertUi,
  connectAs,
  copy,
  ensureFunded,
  expect,
  loadDeployedAddresses,
  publicClient,
  pushCurveNearThreshold,
  readAccruedFees,
  readCallerReward,
  readLpNftOwner,
  readMaxEarlyBuy,
  routes,
  seedToken,
  sel,
  test,
  waitForCurveLocked,
  waitForIndexed,
  waitForKeeperGraduation,
} from "../harness";

// @flow:GRAD-AUTO — Compose keeper auto-fires graduate() on a ReadyToGraduate curve · tx `graduate()`
// assertable-layers: on-chain · indexed · UI  (full 3-layer)
//
// The permissionless graduation is driven by the compose KEEPER (apps/keeper),
// NOT the test: a threshold-crossing buy sent through the UI (mock connector, real
// tx) LOCKS the curve in ReadyToGraduate, and the keeper — which watches the
// on-chain `GraduationReady` event over WS (with a DB-poll fallback) — fires
// graduate() within ~1-2 blocks and earns the caller reward. The test never
// calls graduate() itself.
//
// The transient ReadyToGraduate *interstitial* is asserted here at the on-chain
// layer (phase leaves Trading), NOT as a live UI element: the keeper races to
// clear that state by design (its whole purpose), so a live interstitial DOM
// assertion would be inherently flaky in a keeper-driven flow. The deterministic
// graduating-interstitial UI (both sides disabled, never "paused") is owned by
// ERR-7, which crosses the threshold and NEVER graduates. GRAD-AUTO's UI layer
// asserts the stable, observable outcome: the widget re-engines to the V3 venue
// live (WS `graduated`), the TD-4/TD-5 surface.
test(
  "GRAD-AUTO a UI threshold buy locks the curve and the compose keeper graduates it, earning the caller reward",
  { tag: ["@flow:GRAD-AUTO", "@layer:on-chain", "@layer:indexed", "@layer:ui"] },
  async ({ page }) => {
    // UI buy + the keeper's WS reaction (or DB-poll fallback) + the live V3 flip
    // can exceed the 90s default; give the keeper-driven graduation room.
    test.setTimeout(240_000);
    // The dev fork's unlocked accounts can be left low by earlier activity;
    // self-heal the buyer + the compose keeper's gas so the flow is deterministic.
    await ensureFunded(ROLES.trader.address);
    await ensureFunded(KEEPER_ADDRESS);
    const token = await seedToken({ name: "Keeper Coin", ticker: "KEEP" });
    const { lpFeeVault } = loadDeployedAddresses();

    // Pre-position the curve a SMALL gap short of GRADUATION_ETH server-side; the
    // final threshold-crossing buy goes through the UI below and must stay under
    // MAX_EARLY_BUY (the browser's wall-clock early-window cap), so the gap it
    // closes has to be smaller than that cap. Both the gap and the crossing buy are
    // derived LIVE from the on-chain MAX_EARLY_BUY (= 2.5% × GRADUATION_ETH)
    // so the math tracks the new flat G≈2.484-ETH target (MAX_EARLY_BUY ≈ 0.062 ETH)
    // — a previously-fixed 0.08-ETH gap is now UNcloseable by one sub-cap buy.
    const maxEarly = await readMaxEarlyBuy(token.curve);
    await pushCurveNearThreshold(token.token, token.curve, maxEarly / 2n);

    await page.goto(routes.token(token.token));
    await connectAs(page, "trader");

    await assertUi("send the threshold-crossing buy through the widget (real tx via the mock connector)", async () => {
      // Buy 90% of MAX_EARLY_BUY: comfortably under the widget's wall-clock early-
      // window cap (so the submit stays enabled) yet more than the ≤ maxEarly/2
      // remaining gap, so it crosses — the curve CLAMPS the net to the exact
      // threshold and refunds the overshoot.
      const cross = (maxEarly * 90n) / 100n;

      await sel.buyTab(page).click();
      await sel.amountInput(page).fill(formatEther(cross));
      await expect(sel.submitTrade(page)).toBeEnabled({ timeout: 15_000 });
      await sel.submitTrade(page).click();
      // The optimistic row landing proves the real tx went through the mock
      // connector (no soft-confirmed chip — the feed row is the signal).
      await expect(sel.tradeRows(page).first()).toBeVisible({ timeout: 20_000 });
    });

    let graduated: Awaited<ReturnType<typeof waitForKeeperGraduation>>;
    await assertOnChain("the buy locks the curve; the keeper fires graduate() and earns the caller reward", async () => {
      // The threshold-crossing buy LOCKED the curve — poll until phase leaves
      // Trading (the UI tx may still be a block or two from inclusion). It is
      // ReadyToGraduate now, or already Graduated if the keeper won the race.
      const locked = await waitForCurveLocked(token.curve, { timeoutMs: 30_000 });
      expect(["ready", "graduated"]).toContain(locked);

      // The COMPOSE KEEPER fires graduate() — the test never calls it. Generous
      // timeout for the WS reaction + the DB-poll fallback interval.
      graduated = await waitForKeeperGraduation(token.curve, token.token, { timeoutMs: 90_000 });

      // The keeper (anvil #4) is the caller and earned the reward.
      expect(graduated.args.caller.toLowerCase()).toBe(KEEPER_ADDRESS.toLowerCase());
      const callerReward = await readCallerReward(token.curve);
      expect(graduated.args.callerReward).toBe(callerReward);

      // LP position minted to the LPFeeVault; curve balance is drained to exactly
      // its unswept fee escrow (donation-free here → the "holds zero value" invariant).
      expect(graduated.args.tokenId > 0n).toBe(true);
      const owner = await readLpNftOwner(graduated.args.tokenId);
      expect(owner.toLowerCase()).toBe(lpFeeVault.toLowerCase());
      const curveBalance = await publicClient.getBalance({ address: token.curve });
      const fees = await readAccruedFees(token.curve);
      expect(curveBalance).toBe(fees.total);

      // The keeper NETTED the caller reward minus the graduate() gas. Measure the
      // delta ACROSS THE GRADUATION BLOCK (not a wide window — on a shared fork the
      // keeper also graduates other curves): across just this block the keeper's
      // balance rises by CALLER_REWARD − gas, i.e. it profited on the reward.
      const receipt = await publicClient.getTransactionReceipt({ hash: graduated.txHash });
      const gasCost = receipt.gasUsed * receipt.effectiveGasPrice;
      const keeperBeforeBlock = await publicClient.getBalance({
        address: KEEPER_ADDRESS,
        blockNumber: graduated.blockNumber - 1n,
      });
      const keeperAfterBlock = await publicClient.getBalance({
        address: KEEPER_ADDRESS,
        blockNumber: graduated.blockNumber,
      });
      expect(keeperAfterBlock - keeperBeforeBlock >= callerReward - gasCost).toBe(true);
      expect(keeperAfterBlock > keeperBeforeBlock).toBe(true); // net profit on the reward
    });

    await assertIndexed("the indexer materializes status=graduated with the V3 pool set", async () => {
      const indexed = await waitForIndexed(
        () => api.token(token.token),
        (t) => t?.status === "graduated" && Boolean(t?.v3PoolAddress),
        { label: "status graduated + pool set" },
      );
      expect(indexed.v3PoolAddress.toLowerCase()).toBe(graduated.args.pool.toLowerCase());
    });

    await assertUi("the widget re-engines to the Uniswap V3 venue live, no reload", async () => {
      // The page was loaded BEFORE graduation; the WS `graduated` signal flips the
      // live token status → the widget swaps to the V3 engine (TD-4/TD-5 surface)
      // with no reload.
      await expect(page.getByText(copy.tradingOnV3).first()).toBeVisible({ timeout: 45_000 });
      await expect(page.getByText(copy.graduatingInterstitial)).toHaveCount(0);
    });
  },
);
