// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {console2} from "forge-std/console2.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

import {BaseFixture} from "test/harness/BaseFixture.sol";
import {BondingCurve} from "src/BondingCurve.sol";
import {LaunchToken} from "src/LaunchToken.sol";
import {IBondingCurve} from "src/interfaces/IBondingCurve.sol";
import {EarlyBuyCapExceeded, SlippageExceeded} from "src/errors/Errors.sol";

/// @title Gate-6 economic red-team — curve-side adversary sims under FCFS (gate 6)
/// @notice ADDED BY robbed-security for the gate-6 run (read-only audit; test-additions only, no
///         production-code edits). Deterministic, non-fork mirror of the fork suite
///         `test/fork/EconRedTeam.t.sol` — the numbers below are curve-math facts independent of the
///         V3 venue, so they are proven here fast/deterministically and re-confirmed on the live
///         fork. Everything is measured against the REAL M0 economics ({TestConstants}).
///
/// Adversary patterns (observed bot fleet, priced under FCFS — priority fees do NOT
///         reorder, so the only front-run vector is arrival-order/latency, never a gas bid):
///           1. Sniper: single-tx cap engages; single-actor multi-tx AND multi-wallet bypass cost.
///           2. Sandwich: worst-case (attacker wins ordering) profit bound + victim-slippage floor.
///           3. Wash-loop: fee bleed per round-trip (cost to fake trending/KotH volume).
contract CurveEconRedTeam is BaseFixture {
    uint256 internal constant BPS = 10_000;

    function setUp() public {
        _deployStack();
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 1. SNIPER — anti-sniper guard is a PER-TX gross cap inside a
    //    timestamp window. Quantify what it does and does not stop under FCFS.
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Single-tx over-cap buy reverts inside the window; at-cap succeeds; the guard reads
    ///         `block.timestamp`, never a height opcode (asserted by the window mechanics).
    function test_sniper_singleTx_capEngages() public {
        (LaunchToken token, BondingCurve curve) = _create();
        uint256 cap = uint256(curve.MAX_EARLY_BUY());
        assertLt(block.timestamp, uint256(curve.EARLY_WINDOW_END()), "window must be open at create");

        address sniper = makeAddr("sniper");
        vm.deal(sniper, cap + 2 ether);
        vm.prank(sniper);
        vm.expectRevert(abi.encodeWithSelector(EarlyBuyCapExceeded.selector, cap + 1, cap));
        router.buy{value: cap + 1}(address(token), sniper, 0, block.timestamp);

        vm.prank(sniper);
        uint256 got = router.buy{value: cap}(address(token), sniper, 0, block.timestamp);
        assertGt(got, 0, "at-cap buy inside window must succeed");
    }

    /// @notice THE bypass quantification. A SINGLE EOA sweeps the whole curve to graduation inside
    ///         the early window using only <=cap chunks — the guard has NO per-actor / per-block
    ///         cumulative accounting, so chunking defeats it at ~zero marginal cost (same total fee,
    /// same price impact as one atomic sweep). This is the -acknowledged bypass, now
    ///         priced: the guard blunts a single ATOMIC sweep only.
    function test_sniper_singleActor_multiTx_bypassCost() public {
        (LaunchToken token, BondingCurve curve) = _create();
        uint256 cap = uint256(curve.MAX_EARLY_BUY());
        uint256 windowEnd = uint256(curve.EARLY_WINDOW_END());

        address sniper = makeAddr("chunkSniper");
        uint256 chunks;
        uint256 grossSpent;
        // Stay inside the window the whole time (no warp): every buy sees block.timestamp < END.
        while (curve.phase() == IBondingCurve.Phase.Trading && chunks < 100) {
            assertLt(block.timestamp, windowEnd, "still inside anti-sniper window");
            (,, uint256 realEth,) = curve.reserves();
            uint256 remainingNet = curve.GRADUATION_ETH() - realEth;
            uint256 grossToFinish = Math.ceilDiv(remainingNet * BPS, BPS - curve.TRADE_FEE_BPS());
            uint256 grossThisChunk = grossToFinish < cap ? grossToFinish : cap; // never exceed cap
            vm.deal(sniper, grossThisChunk);
            vm.prank(sniper);
            router.buy{value: grossThisChunk}(address(token), sniper, 0, block.timestamp);
            grossSpent += grossThisChunk;
            chunks++;
        }

        assertEq(uint8(curve.phase()), uint8(IBondingCurve.Phase.ReadyToGraduate), "single actor swept to graduation");
        // The sniper now holds essentially the ENTIRE circulating supply, acquired inside the window
        // via chunking — the cap did not bound cumulative acquisition by one actor.
        uint256 sniperTokens = token.balanceOf(sniper);
        (,,, uint256 realTokenLeft) = curve.reserves();
        assertGt(sniperTokens, curve.CURVE_SUPPLY() * 99 / 100, "chunk-sniper took >99% of curve supply");

        console2.log("=== SNIPER: single-actor multi-tx bypass ===");
        console2.log("MAX_EARLY_BUY (wei)          :", cap);
        console2.log("chunks (txs) to graduate     :", chunks);
        console2.log("gross ETH spent (wei)        :", grossSpent);
        console2.log("fee paid = 1%% of gross (wei) :", grossSpent * curve.TRADE_FEE_BPS() / BPS);
        console2.log("sniper token balance         :", sniperTokens);
        console2.log("curve tokens left            :", realTokenLeft);
        // Bypass cost vs a hypothetical single atomic sweep: fee and price impact are IDENTICAL
        // (both are functions of cumulative net ETH only). Marginal cost of the bypass = gas for
        // (chunks-1) extra txs — economically negligible for a funded operator.
    }

    /// @notice Multi-wallet variant (shared gas funder) N wallets each buy <=cap. Same total
    ///         acquisition, same fee, same price impact as the single-actor chunked sweep — the only
    /// added cost over chunking is funding N wallets. Confirms 's multi-wallet
    ///         acknowledgment and prices it: near-zero marginal cost.
    function test_sniper_multiWallet_sharedFunder_bypassCost() public {
        (LaunchToken token, BondingCurve curve) = _create();
        uint256 cap = uint256(curve.MAX_EARLY_BUY());
        address funder = makeAddr("gasFunder");

        uint256 wallets;
        uint256 grossSpent;
        while (curve.phase() == IBondingCurve.Phase.Trading && wallets < 100) {
            (,, uint256 realEth,) = curve.reserves();
            uint256 remainingNet = curve.GRADUATION_ETH() - realEth;
            uint256 grossToFinish = Math.ceilDiv(remainingNet * BPS, BPS - curve.TRADE_FEE_BPS());
            uint256 g = grossToFinish < cap ? grossToFinish : cap;
            // Fresh wallet each iteration, funded by the shared funder (models the observed pattern).
            address w = makeAddr(string(abi.encodePacked("snipeWallet", vm.toString(wallets))));
            vm.deal(funder, g);
            vm.prank(funder);
            (bool ok,) = w.call{value: g}("");
            assertTrue(ok, "funder->wallet");
            vm.prank(w);
            router.buy{value: g}(address(token), w, 0, block.timestamp);
            grossSpent += g;
            wallets++;
        }
        assertEq(uint8(curve.phase()), uint8(IBondingCurve.Phase.ReadyToGraduate), "multi-wallet swept to graduation");
        console2.log("=== SNIPER: multi-wallet shared-funder bypass ===");
        console2.log("wallets used                 :", wallets);
        console2.log("gross ETH swept (wei)        :", grossSpent);
        // Identical economics to the single-actor chunk sweep; extra cost = wallet-funding gas only.
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 2. SANDWICH — under FCFS priority fees cannot reorder; model the WORST case
    //    (attacker wins arrival order) and bound the extractable value.
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Worst-case sandwich: attacker front-runs, victim buys, attacker sells — one ordered
    ///         sequence (as if the attacker won the FCFS arrival race). FINDING: the 1%+1% round-trip
    ///         fee does NOT make this unprofitable at realistic victim sizes — under adversarial
    ///         ordering the sandwich nets a positive profit. Quantifies the residual (== a naive
    ///         victim's slippage); the real mitigations are FCFS ordering + victim slippage, not fees.
    function test_sandwich_worstCaseOrdering_residualExposure() public {
        (LaunchToken token, BondingCurve curve) = _create();
        vm.warp(uint256(curve.EARLY_WINDOW_END())); // past the anti-sniper cap so sizes are free

        // Seed the curve to a realistic mid-life state so we are not at the degenerate start.
        _buy(curve, token, makeAddr("seed"), 0.5 ether, 0); // headroom under G=2.484 for the sandwich legs

        // Baseline: what the victim receives with NO front-run (its fair fill).
        (uint256 fairFill,,,) = curve.quoteBuy(0.3 ether);

        address attacker = makeAddr("sandwichAttacker");
        address victim = makeAddr("sandwichVictim");
        uint256 frontRun = 0.5 ether;

        vm.deal(attacker, 10 ether);
        vm.prank(attacker); // (1) front-run
        uint256 attackerTokens = router.buy{value: frontRun}(address(token), attacker, 0, block.timestamp);
        uint256 victimFill = _buy(curve, token, victim, 0.3 ether, 0); // (2) naive victim, min=0
        uint256 ethBack = _sell(curve, token, attacker, attackerTokens, 0); // (3) unwind

        int256 attackerNet = int256(ethBack) - int256(frontRun);
        uint256 victimTokenLossBps = (fairFill - victimFill) * BPS / fairFill;
        console2.log("=== SANDWICH: worst-case ordering (attacker wins the FCFS arrival race) ===");
        console2.log("front-run ETH (wei)          :", frontRun);
        console2.log("victim buy ETH (wei)         :", uint256(0.3 ether));
        console2.log("attacker net profit (wei)    :");
        console2.logInt(attackerNet);
        console2.log("victim token loss (bps)      :", victimTokenLossBps);
        // FINDING: the 2% round-trip fee does NOT neutralize the sandwich — under adversarial
        // ordering it is PROFITABLE for realistic victim sizes. The real mitigations are (i) FCFS
        // removing the priority-fee reordering vector (the attacker must WIN the arrival race, not
        // outbid gas) and (ii) the victim's own slippage/deadline. Residual exposure == a naive
        // (min=0) victim's slippage. Reported as a Medium in the gate-6 register.
        assertGt(attackerNet, int256(0), "worst-case sandwich is profitable vs a naive victim (residual is real)");
        assertGt(victimTokenLossBps, 0, "naive victim absorbs the price impact");
    }

    /// @notice Victim slippage is a HARD ceiling on sandwich damage: a `minTokensOut` set to (1 - S)
    ///         of the fair quote makes any front-run that would push the victim's realized loss past
    ///         S revert the VICTIM's tx (no fill) instead of filling at a bad price — so a
    ///         slippage-setting victim caps their loss at S and denies the attacker the extraction.
    function test_sandwich_victimSlippageBoundsLoss() public {
        (LaunchToken token, BondingCurve curve) = _create();
        vm.warp(uint256(curve.EARLY_WINDOW_END()));
        _buy(curve, token, makeAddr("seed2"), 2 ether, 0);

        address attacker = makeAddr("sandwichAttacker2");
        address victim = makeAddr("sandwichVictim2");

        // Victim quotes at the current state and demands >=99% of it (1% slippage tolerance).
        (uint256 quotedTokens,,,) = curve.quoteBuy(0.3 ether);
        uint256 victimMin = quotedTokens * 99 / 100;

        // Attacker front-runs hard to push price up past the victim's 1% tolerance.
        vm.deal(attacker, 5 ether);
        vm.prank(attacker);
        router.buy{value: 3 ether}(address(token), attacker, 0, block.timestamp);

        // Victim's buy now under-delivers vs its floor and MUST revert — loss capped at zero fill.
        vm.deal(victim, 0.3 ether);
        vm.prank(victim);
        vm.expectRevert(); // SlippageExceeded — victim protected: no fill, no extraction
        router.buy{value: 0.3 ether}(address(token), victim, victimMin, block.timestamp);
        console2.log("=== SANDWICH: victim slippage ceiling holds (victim tx reverted, loss capped at 1%) ===");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 3. WASH-LOOP — fee bleed to fabricate trending / King-of-the-Hill volume.
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice One buy->sell round trip loses ~2% of notional to the in-contract fee (1% each leg)
    ///         plus curve-favoring rounding; the curve captures it as `accruedFees`. Quantifies the
    ///         cost to wash a unit of volume — the economic reason wash-to-trend is a continuous
    /// bleed (indexer additionally flags round-trip clusters out of organic metrics).
    function test_wash_roundTrip_feeBleed() public {
        (LaunchToken token, BondingCurve curve) = _create();
        vm.warp(uint256(curve.EARLY_WINDOW_END()));
        _buy(curve, token, makeAddr("seed3"), 0.5 ether, 0); // mid-life seed, headroom under G=2.484

        // Single clean round trip: buy 1 ETH notional, immediately sell it all back.
        uint256 rtLoss = _oneWashRoundTrip(curve, token, makeAddr("washerA"), 1 ether);
        console2.log("=== WASH: single round-trip fee bleed ===");
        console2.log("single round-trip notional   :", uint256(1 ether));
        console2.log("single round-trip loss (wei) :", rtLoss);
        // ~2% (1% each leg) minus curve-favoring rounding; strictly a loss to the washer.
        assertGe(rtLoss * 1000 / 1 ether, 19, "round-trip loss should be >= ~1.9% of notional");

        // Sustained washing recycles the residue: 5 rounds bleed the balance monotonically into the
        // curve as fees. Quantifies the continuous cost of fabricating trending / KotH volume.
        (uint256 burned, uint256 feeCaptured) = _sustainedWash(curve, token, makeAddr("washerB"), 1 ether, 5);
        console2.log("=== WASH: sustained 5-round bleed ===");
        console2.log("washer ETH burned (wei)      :", burned);
        console2.log("curve fees captured (wei)    :", feeCaptured);
        assertGt(feeCaptured, 0, "wash volume must feed curve fees (cost to washer)");
        assertGe(burned, feeCaptured, "washer loss >= fees captured");
    }

    /// @dev One buy->sell round trip; returns the ETH lost (notional - returned).
    function _oneWashRoundTrip(BondingCurve curve, LaunchToken token, address washer, uint256 notional)
        internal
        returns (uint256 rtLoss)
    {
        vm.deal(washer, notional);
        vm.prank(washer);
        uint256 got = router.buy{value: notional}(address(token), washer, 0, block.timestamp);
        uint256 back = _sell(curve, token, washer, got, 0);
        rtLoss = notional - back;
    }

    /// @dev Recycle the washer's residual balance for `rounds` round-trips; returns (ETH burned,
    ///      curve fees captured over the run).
    function _sustainedWash(BondingCurve curve, LaunchToken token, address washer, uint256 seed, uint256 rounds)
        internal
        returns (uint256 burned, uint256 feeCaptured)
    {
        uint256 feesBefore = curve.accruedFees();
        vm.deal(washer, seed);
        uint256 startBal = washer.balance;
        for (uint256 i = 0; i < rounds; i++) {
            uint256 bal = washer.balance;
            if (bal == 0) break;
            vm.prank(washer);
            uint256 got = router.buy{value: bal}(address(token), washer, 0, block.timestamp);
            _sell(curve, token, washer, got, 0);
        }
        burned = startBal - washer.balance;
        feeCaptured = curve.accruedFees() - feesBefore;
    }
}
