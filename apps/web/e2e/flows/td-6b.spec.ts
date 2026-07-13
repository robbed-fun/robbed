import {
  KEEPER_ADDRESS,
  ROLES,
  api,
  assertIndexed,
  assertOnChain,
  assertUi,
  copy,
  crossGraduationThreshold,
  donateToCurveOnChain,
  ensureFunded,
  expect,
  loadDeployedAddresses,
  publicClient,
  readAccruedFees,
  readGraduationEth,
  readLpNftOwner,
  routes,
  seedToken,
  test,
  waitForIndexed,
  waitForKeeperGraduation,
} from "../harness";

// @flow:TD-6b — Graduation succeeds despite a large curve donation (F-1 regression) · tx `graduate()` (§12.12/§6.3/§12.33)
// assertable-layers: on-chain · indexed · UI  (full 3-layer)
//
// The UI/integration analog of the Foundry `MigratorDonationFreeze` regression.
// A donation ABOVE ~1% of GRADUATION_ETH pushed the migrator's WETH-min floor to
// the donation-inflated `wethForMint` (pre-fix), so `NPM.mint` reverted "Price
// slippage check", `graduate()` reverted, and the curve FROZE in ReadyToGraduate
// (spec §12.12). The fix anchors `wethMin` to `min(wethForMint, W*)` — the donated
// ETH has no paired token and surfaces as WETH dust to the treasury. Graduation is
// KEEPER-DRIVEN (uniform with GRAD-AUTO): the test never calls graduate(); the
// compose keeper can only reach Graduated if the F-1 fix holds — pre-fix it would
// hit its persistent-revert cooldown and this flow would time out in
// `waitForKeeperGraduation`.
test(
  "TD-6b keeper graduates a curve with a large donation; the donation surfaces as WETH dust, never stranded",
  { tag: ["@flow:TD-6b", "@layer:on-chain", "@layer:indexed", "@layer:ui"] },
  async ({ page }) => {
    // Seed + donation + buy-to-threshold + the keeper's reaction can exceed the
    // 90s default; give the keeper-driven graduation room (still bounded).
    test.setTimeout(240_000);
    // The dev fork's unlocked accounts can be left low by earlier activity;
    // self-heal the buyer (#2), the donor (#3), and the keeper's gas (#4).
    await ensureFunded(ROLES.trader.address);
    await ensureFunded(ROLES.trader2.address);
    await ensureFunded(KEEPER_ADDRESS);
    const token = await seedToken({ name: "Donation Coin", ticker: "DONG" });
    const { lpFeeVault } = loadDeployedAddresses();

    // A donation WELL over the pre-fix freeze threshold (~1% of GRADUATION_ETH).
    // Derived LIVE from the on-chain threshold so it tracks the new flat G≈2.484-ETH
    // target: 8% of GRADUATION_ETH (~0.199 ETH) is comfortably over the ~1% (~0.025
    // ETH) freeze line the F-1 fix addresses — never a fixed ETH figure. Sent BEFORE
    // crossing the threshold so it is in the curve balance at graduation — the exact
    // scenario that froze pre-fix.
    const gradEth = await readGraduationEth(token.curve);
    const donation = (gradEth * 8n) / 100n;
    const donateHash = await donateToCurveOnChain(token.curve, donation);
    await publicClient.waitForTransactionReceipt({ hash: donateHash });

    // Buy to GRADUATION_ETH → ReadyToGraduate (keeper-safe; never calls graduate()).
    await crossGraduationThreshold(token.token, token.curve);

    // The keeper MUST fire graduate() and succeed despite the donation.
    const graduated = await waitForKeeperGraduation(token.curve, token.token, {
      timeoutMs: 90_000,
    });

    await assertOnChain(
      "graduation succeeded; donation surfaced as WETH dust, NOT stranded in the curve",
      async () => {
        // A real LP position was minted.
        expect(graduated.args.tokenId > 0n).toBe(true);
        expect(graduated.args.liquidity > 0n).toBe(true);

        // The donated ETH surfaced as WETH dust to the treasury (the fix's
        // mechanism) rather than pairing into the LP or reverting the mint.
        expect(graduated.args.wethDustToTreasury > 0n).toBe(true);
        expect(graduated.args.wethDustToTreasury >= (donation * 80n) / 100n).toBe(true);

        // The LP-position NFT is owned by the LPFeeVault (principal permanently
        // locked, §6.3/§12.14).
        const owner = await readLpNftOwner(graduated.args.tokenId);
        expect(owner.toLowerCase()).toBe(lpFeeVault.toLowerCase());

        // Post-grad the curve holds EXACTLY its unswept fee escrow — the donation
        // did NOT strand (pre-fix it would have been trapped ABOVE this sum, or the
        // whole graduation would have reverted). This is the "post-grad curve holds
        // zero value (unswept fees excluded)" invariant.
        const curveBalance = await publicClient.getBalance({ address: token.curve });
        const fees = await readAccruedFees(token.curve);
        expect(curveBalance).toBe(fees.total);
      },
    );

    await assertIndexed("the indexer materializes status=graduated with the V3 pool set", async () => {
      const indexed = await waitForIndexed(
        () => api.token(token.token),
        (t) => t?.status === "graduated" && Boolean(t?.v3PoolAddress),
        { label: "status graduated + pool set" },
      );
      expect(indexed.v3PoolAddress).toMatch(/^0x[0-9a-fA-F]{40}$/);
      // The indexed pool is the same one the on-chain Graduated event announced.
      expect(indexed.v3PoolAddress.toLowerCase()).toBe(graduated.args.pool.toLowerCase());
    });

    await assertUi("token detail renders the graduated badge and the Uniswap V3 venue", async () => {
      // Loaded AFTER graduation → SSR status is `graduated`, so both the header
      // pill and the widget's V3 engine render on first paint (TD-4/TD-5 surface).
      await page.goto(routes.token(token.token));
      await expect(page.getByText(copy.graduatedPill).first()).toBeVisible();
      await expect(page.getByText(copy.tradingOnV3).first()).toBeVisible();
      // No graduating interstitial lingers once graduated.
      await expect(page.getByText(copy.graduatingInterstitial)).toHaveCount(0);
    });
  },
);
