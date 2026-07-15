import {
  EXPECTED_CREATOR_FEE_BPS,
  ROLES,
  WETH,
  antiSniperWindowSeconds,
  api,
  assertIndexed,
  assertOnChain,
  buyOnChain,
  collectOnChain,
  expect,
  generatePostGradFees,
  graduateToken,
  parseCollectSplit,
  parseEther,
  publicClient,
  readAccruedCreatorFees,
  readCreatorEthClaimable,
  readCreatorTokenClaimable,
  readCurveCreatorFeeBps,
  readGraduatedEvent,
  seedToken,
  sweepCreatorFeesOnChain,
  test,
  waitForIndexed,
  warpTime,
} from "../harness";

// @flow:CFEE-2 — Venue-invariant 0.5% creator rate end-to-end (curve pre-grad AND V3 post-grad) ·
// assertable-layers: on-chain · indexed   (UI waived — see waivers)
//
// WIDENED 2026-07-13 (creator-fee generation DEPLOYED to the fork): un-skipped and
// widened from on-chain-only to on-chain · INDEXED. Proves the ONE honest "0.5% of
// your token's lifetime volume, on the curve AND on Uniswap" story — no discontinuity
// at graduation — at BOTH the chain layer AND the indexed claim surface: the
// pre-grad native-ETH leg reconciles on `GET /v1/creators/:creator/claimable`
// (`CreatorVault.balanceOf` over the `creator_claimable` roll-up) and the post-grad
// WETH leg on `GET /v1/creators/:creator/claimable/:weth` (`tokenBalanceOf` over
// `creator_token_claimable`). The Portfolio list endpoint exists; the browser
// claim-button assertion is owned by CFEE-1.
test(
  "CFEE-2 the creator earns ~0.5% of volume on the curve (pre-grad) AND ~0.5% post-grad (V3 split) — venue-invariant, indexed both legs",
  { tag: ["@flow:CFEE-2", "@layer:on-chain", "@layer:indexed"] },
  async ({}) => {
    test.setTimeout(240_000);

    const creator = ROLES.creator.address;
    const token = await seedToken({
      creator: ROLES.creator,
      name: "Venue Invariant Coin",
      ticker: "VINV",
    });

    // Standing on-chain vault balances carried into the indexed reconcile.
    let ethClaimableStanding = 0n;
    let wethStanding = 0n;

    await assertOnChain(
      "the creator's absolute rate is ~0.5% of volume BOTH pre-grad (curve leg) and post-grad (V3 split) — no discontinuity at graduation",
      async () => {
        // The curve leg is the 50-bps creator fee.
        expect(await readCurveCreatorFeeBps(token.curve)).toBe(EXPECTED_CREATOR_FEE_BPS);

        // ── PRE-GRAD (curve): buy a KNOWN gross volume; the creator escrow accrues
        // EXACTLY 0.5% of it (fee computed in-contract). The pre-grad leg is
        // NATIVE ETH (swept via sweepCreatorFees → CreatorVault.balanceOf). ────────
        await warpTime(antiSniperWindowSeconds() + 2); // past the anti-sniper cap
        const preVolume = parseEther("0.03") + parseEther("0.04");
        const accruedBefore = await readAccruedCreatorFees(token.curve);
        for (const v of [parseEther("0.03"), parseEther("0.04")]) {
          const h = await buyOnChain({ buyer: ROLES.trader, token: token.token, ethWei: v });
          await publicClient.waitForTransactionReceipt({ hash: h });
        }
        const accruedAfter = await readAccruedCreatorFees(token.curve);
        const preCreatorFee = accruedAfter - accruedBefore;
        // EXACT: fee = gross × 50 / 10000 (the pre-grad 0.5% rate).
        expect(preCreatorFee).toBe((preVolume * BigInt(EXPECTED_CREATOR_FEE_BPS)) / 10_000n);

        // Sweep the curve leg to the CreatorVault (pull-payment landing).
        const vaultBefore = await readCreatorEthClaimable(creator);
        const sweepHash = await sweepCreatorFeesOnChain(token.curve, ROLES.trader);
        await publicClient.waitForTransactionReceipt({ hash: sweepHash });
        const vaultAfter = await readCreatorEthClaimable(creator);
        // The whole accrued creator escrow (≥ preCreatorFee) landed in the vault.
        expect(vaultAfter - vaultBefore >= preCreatorFee).toBe(true);
        ethClaimableStanding = vaultAfter;

        // ── POST-GRAD (V3): a KNOWN WETH-in buy accrues a 1% pool fee; the 50/50
        // split gives the creator ~0.5% of that volume. The post-grad WETH leg is
        // ERC20 (CreatorVault.tokenBalanceOf(creator, WETH)), NOT native ETH. ──────
        await graduateToken(token.token, token.curve);
        const gradEv = await readGraduatedEvent(token.token);
        const tokenId = gradEv!.args.tokenId;

        const postVolume = parseEther("0.05");
        const creatorWethBefore = await readCreatorTokenClaimable(creator, WETH);
        await generatePostGradFees(token.token, { ethIn: postVolume, by: ROLES.trader2 });
        const collectHash = await collectOnChain(tokenId, ROLES.trader);
        const collectReceipt = await publicClient.waitForTransactionReceipt({ hash: collectHash });
        const collected = parseCollectSplit(collectReceipt.logs, token.token);
        const postCreatorWethCredit =
          (await readCreatorTokenClaimable(creator, WETH)) - creatorWethBefore;

        // The creator's WETH-leg credit is EXACTLY the FeesSplit creator share
        // (F(i)) — and that WETH-leg ≈ 1% of the buy volume, so the credit ≈
        // 0.5% of `postVolume`. Assert the venue-invariant absolute rate: the
        // post-grad creator rate lands in a tight band around the pre-grad 0.5%.
        expect(postCreatorWethCredit).toBe(collected.creatorWeth);
        const lo = (postVolume * 40n) / 10_000n; // 0.40%
        const hi = (postVolume * 60n) / 10_000n; // 0.60%
        expect(postCreatorWethCredit >= lo && postCreatorWethCredit <= hi).toBe(true);
        wethStanding = await readCreatorTokenClaimable(creator, WETH);
      },
    );

    await assertIndexed(
      "both legs surface on the creator-claimable API, reconciled to the on-chain vault balances (venue-invariant, indexed)",
      async () => {
        // Pre-grad NATIVE-ETH leg: `GET /v1/creators/:creator/claimable` serves the
        // authoritative live `CreatorVault.balanceOf` over the indexed `creator_claimable`.
        const ethLeg = await waitForIndexed(
          () => api.creatorClaimable(creator),
          (d) => BigInt(d.claimableEth) === ethClaimableStanding && ethClaimableStanding > 0n,
          { label: "eth-leg claimable indexed", timeoutMs: 30_000 },
        );
        expect(ethLeg.creator.toLowerCase()).toBe(creator.toLowerCase());
        expect(BigInt(ethLeg.claimableEth)).toBe(ethClaimableStanding);

        // Post-grad WETH leg: `GET /v1/creators/:creator/claimable/:weth` serves the
        // live `tokenBalanceOf(creator, WETH)` over the indexed `creator_token_claimable`.
        const wethLeg = await waitForIndexed(
          () => api.creatorTokenClaimable(creator, WETH),
          (d) => BigInt(d.claimable) === wethStanding && wethStanding > 0n,
          { label: "weth-leg claimable indexed", timeoutMs: 30_000 },
        );
        expect(wethLeg.token.toLowerCase()).toBe(WETH.toLowerCase());
        expect(BigInt(wethLeg.claimable)).toBe(wethStanding);
      },
    );
  },
);
