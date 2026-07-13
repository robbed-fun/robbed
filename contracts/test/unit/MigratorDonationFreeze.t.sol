// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";

import {V3Fixture} from "test/harness/V3Fixture.sol";
import {TestConstants} from "test/harness/TestConstants.sol";
import {LaunchToken} from "src/LaunchToken.sol";
import {BondingCurve} from "src/BondingCurve.sol";
import {IBondingCurve} from "src/interfaces/IBondingCurve.sol";

/// @title F-1 donation-freeze regression — curve ETH donations must NEVER freeze graduation
///        (finding F-1, HIGH, PoC-confirmed 2026-07-13; spec §6.3.2, §12.12, §12.13, §10 gate 2)
/// @notice THE BUG: {BondingCurve} exposes an ungated `receive()` (spec §5.7 donations), and
///         `graduate()` forwards the curve's ENTIRE ETH balance — donations included — so the
///         migrator sees `wethForMint = W* + donation`, where `W* = GRADUATION_ETH − CALLER_REWARD −
///         GRADUATION_FEE` is the only WETH a full-range position at the (verified) target price can
///         absorb (it pairs with `LP_TOKEN_TRANCHE`; donated ETH has no paired token). Pre-fix, the
///         mint's WETH amount-min anchored to the donation-inflated `wethForMint`, demanding
///         `(W* + donation)·(1 − slippageBps)` in the position — unachievable once
///         `donation > W*·bps/(1−bps)` (~1% of G ≈ 0.08 ETH on the M0 fixture) — so `NPM.mint`
///         reverted "Price slippage check", `graduate()` reverted FOREVER, and the curve froze in
///         `ReadyToGraduate` where BOTH buys and sells revert `NotTrading` (§12.12): a ~0.08 ETH
///         donation permanently locked the whole raise and every holder's exit, on a pristine
///         at-target pool. Post-fix the floor anchors to `min(wethForMint, W*)` (V3Migrator decision
///         #5), so a donation surfaces as MORE treasury WETH dust — never a revert.
///
///         WHY THE 217-TEST SUITE MISSED IT (the exact gaps this file closes): the fork lifecycle
///         donated only 0.01 ETH (below the ~1% threshold); the invariant `PoolGriefHandler` donated
///         to the POOL, not the curve; and `CurveHandler.donateEthToCurve` graduates through a
///         MockMigrator, so the real NPM amount-min never executed against a curve donation.
///
/// @dev Assertion strategy (recorded per the research→decide→record→verify loop):
///      1. LIVENESS — `graduate()` must SUCCEED for donations of 2%·G, 10%·G, and 10×G (all far
///         above the pre-fix ~1% freeze threshold), plus a fuzz sweep over [1 wei, 10×G].
///      2. WEI-EXACT CONSERVATION — `gradFee + wethInPosition + wethDust == G + donation −
///         CALLER_REWARD`: every donated wei reaches the treasury (fee+dust legs, asserted against
///         the treasury's actual WETH receipt) or the price-verified LP position; none sticks in the
///         migrator (balances asserted zero) and none is lost.
///      3. DUST EXACTNESS vs a CONTROL graduation (donation = 0, identical fill sequence, same
///         forced token ordering): `wethDust_donated − wethDust_control ∈ [donation − 1 gwei,
///         donation]`. The sub-`donation` slack is NOT slippage: at the fixed target price the
///         donated run's position may absorb at most the pairing value of the curve's token
///         rounding leftover (≤ ~1e8 token-wei from the single clamped fill ≈ single-digit wei of
///         WETH at p ≈ 3.9e-8, plus wei-level liquidity rounding — cf. constants.json
///         derivation.lpDust, both sides < 3000 wei). 1 gwei bounds that with ~7 orders of margin
///         while still failing loudly if any donation fraction ever leaked into the position.
///      4. NON-VACUITY — every directed donation is proven to sit ABOVE the pre-fix freeze
///         threshold: the OLD floor `(W* + donation)·(1 − bps)` strictly exceeds the WETH the
///         position actually absorbed, i.e. the pre-fix anchor demonstrably could not have minted.
///      Both token/WETH orderings are exercised (MockWETH9 etched at an extreme address, the
///      MigratorArbBackKill kill-test-2 technique) since the mint's min lands on amount0Min or
///      amount1Min depending on sort order.
abstract contract MigratorDonationFreezeBase is Test, V3Fixture {
    address internal treasury = makeAddr("f1Treasury");
    address internal owner = makeAddr("f1Owner");
    address internal buyer = makeAddr("f1Buyer");
    address internal grad = makeAddr("f1Graduator");
    address internal donor = makeAddr("f1Donor");

    uint256 internal constant BPS = 10_000;

    /// @dev Decision #3 above: bounds the position-absorbable pairing value of the curve's token
    ///      rounding leftover (analysis: single-digit wei) with ~7 orders of magnitude of margin.
    uint256 internal constant DUST_DELTA_EPS = 1 gwei;

    bytes32 internal constant GRADUATED_SIG =
        keccak256("Graduated(address,address,uint256,uint128,uint256,uint256,uint256,address,uint256,uint256,uint256)");

    /// @dev Control baseline (donation = 0): identical fill sequence, so the donated runs differ
    ///      from it ONLY by the donation. Captured in setUp.
    uint256 internal controlWethDust;
    uint256 internal controlWethInPos;

    /// @dev Where to etch MockWETH9 to force the token/WETH sort order (see {V3Fixture}).
    function _wethAt() internal pure virtual returns (address);
    /// @dev The ordering this instantiation forces (asserted on every subject — never vacuous).
    function _expectToken0() internal pure virtual returns (bool);

    function setUp() public {
        _deployV3FullStack(treasury, owner, _wethAt(), TestConstants.MIGRATION_SLIPPAGE_BPS);
        GradResult memory control = _graduateWithDonation(0, "f1Control");
        controlWethDust = control.wethDust;
        controlWethInPos = control.wethInPos;
    }

    // ───────────────────────────── directed regressions ─────────────────────────

    /// @notice 2% of G ≈ 0.158 ETH — ~2× the pre-fix freeze threshold. Pre-fix: frozen forever.
    function test_F1_donation2pctOfG_graduates_dustExact() public {
        _runDonationRegression((TestConstants.GRADUATION_ETH * 2) / 100);
    }

    /// @notice 10% of G ≈ 0.79 ETH. Pre-fix: frozen forever.
    function test_F1_donation10pctOfG_graduates_dustExact() public {
        _runDonationRegression(TestConstants.GRADUATION_ETH / 10);
    }

    /// @notice 10× G ≈ 79 ETH — donation an order of magnitude beyond the whole raise.
    function test_F1_donation10xG_graduates_dustExact() public {
        _runDonationRegression(TestConstants.GRADUATION_ETH * 10);
    }

    // ─────────────────────────────── fuzz sweep ─────────────────────────────────

    /// @notice Any donation in [1 wei, 10×G] must graduate and split wei-exactly (conservation is
    ///         asserted inside {_graduateWithDonation}); the donation never inflates the position
    ///         beyond the leftover-pairing epsilon. Runs bounded: each run executes TWO full
    ///         create→fill→graduate lifecycles (control in setUp + the donated subject) against the
    ///         real vendored V3 bytecode.
    /// forge-config: default.fuzz.runs = 16
    function testFuzz_F1_donation_neverFreezesGraduation(uint256 donationSeed) public {
        uint256 donation = bound(donationSeed, 1, TestConstants.GRADUATION_ETH * 10);
        GradResult memory r = _graduateWithDonation(donation, "f1Fuzz");
        // Donation surfaces as treasury dust (never absorbed into the position beyond epsilon).
        assertGe(r.wethDust + DUST_DELTA_EPS, controlWethDust + donation, "F-1 fuzz: donated ETH not in dust");
        assertLe(r.wethDust, controlWethDust + donation, "F-1 fuzz: dust exceeds donation + control");
        assertLe(r.wethInPos, controlWethInPos + DUST_DELTA_EPS, "F-1 fuzz: donation entered the LP position");
    }

    // ────────────────────────────────── core ────────────────────────────────────

    struct GradResult {
        uint256 wethInPos;
        uint256 wethDust;
        uint256 gradFee;
    }

    function _runDonationRegression(uint256 donation) internal {
        GradResult memory r = _graduateWithDonation(donation, "f1Donated");

        // Dust exactness vs control (decision #3): the donation surfaces as MORE treasury WETH
        // dust, wei-exact up to the leftover-pairing epsilon, never less.
        assertGe(
            r.wethDust + DUST_DELTA_EPS, controlWethDust + donation, "F-1: donation did not surface as treasury dust"
        );
        assertLe(r.wethDust, controlWethDust + donation, "F-1: dust exceeds control + donation (accounting hole)");
        assertLe(r.wethInPos, controlWethInPos + DUST_DELTA_EPS, "F-1: donation was minted into the LP position");

        // Non-vacuity (decision #4): the PRE-FIX floor `(W* + donation)·(1 − bps)` strictly exceeds
        // the WETH the position actually absorbed — with the old anchor, NPM.mint's amount-min
        // could not have been met, i.e. THIS donation reproduces the freeze against unfixed code.
        uint256 preFixFloor = ((_wStar() + donation) * (BPS - TestConstants.MIGRATION_SLIPPAGE_BPS)) / BPS;
        assertGt(preFixFloor, r.wethInPos, "F-1: donation below the pre-fix freeze threshold (regression vacuous)");
    }

    /// @dev One full lifecycle: create → fill to ReadyToGraduate → donate to the CURVE (ungated
    ///      receive(), the F-1 vector) → graduate through the REAL V3Migrator + real NPM. Asserts
    ///      liveness, wei-exact conservation, treasury receipt, and zero-value terminal state.
    function _graduateWithDonation(uint256 donation, string memory tag) internal returns (GradResult memory r) {
        (LaunchToken token, BondingCurve curve,) = _createSubject(makeAddr(tag));
        assertEq(address(token) < address(weth), _expectToken0(), "fixture: forced token/WETH ordering not in effect");
        _fillToReady(curve, token);

        if (donation != 0) {
            vm.deal(donor, donation);
            vm.prank(donor);
            (bool ok,) = address(curve).call{value: donation}("");
            assertTrue(ok, "curve receive() refused the donation");
        }

        uint256 treasuryWethBefore = weth.balanceOf(treasury);
        vm.recordLogs();
        vm.prank(grad);
        curve.graduate(); // F-1 LIVENESS: pre-fix this reverted ("Price slippage check") for donation > ~1%·W*
        assertEq(uint8(curve.phase()), uint8(IBondingCurve.Phase.Graduated), "F-1: curve did not graduate");

        r = _decodeGraduated();

        // Wei-exact WETH conservation (decision #2): fee + position + dust == G + donation − reward.
        assertEq(
            r.gradFee + r.wethInPos + r.wethDust,
            curve.GRADUATION_ETH() + donation - curve.CALLER_REWARD(),
            "F-1: WETH conservation broken (donated wei lost)"
        );
        // The treasury actually RECEIVED fee + dust (the event is not just self-consistent).
        assertEq(
            weth.balanceOf(treasury) - treasuryWethBefore,
            r.gradFee + r.wethDust,
            "F-1: treasury WETH receipt != gradFee + wethDust"
        );
        // Migrator retains nothing; curve holds only the fee escrow, then zero after the sweep.
        assertEq(weth.balanceOf(address(migrator)), 0, "F-1: migrator retained WETH");
        assertEq(token.balanceOf(address(migrator)), 0, "F-1: migrator retained tokens");
        curve.sweepFees();
        assertEq(address(curve).balance, 0, "F-1: curve holds residual ETH after sweep");
    }

    /// @dev `W* = GRADUATION_ETH − CALLER_REWARD − GRADUATION_FEE` — the donation-invariant WETH
    ///      leg the position can absorb at the target price (V3Migrator decision #5).
    function _wStar() internal pure returns (uint256) {
        return TestConstants.GRADUATION_ETH - TestConstants.CALLER_REWARD - TestConstants.GRADUATION_FEE;
    }

    function _fillToReady(BondingCurve curve, LaunchToken token) internal {
        vm.warp(uint256(curve.EARLY_WINDOW_END()) + 1);
        (,, uint256 realEth,) = curve.reserves();
        uint256 remaining = curve.GRADUATION_ETH() - realEth;
        uint256 gross = (remaining * 10_000) / (10_000 - curve.TRADE_FEE_BPS()) + 1e15;
        vm.deal(buyer, gross);
        vm.prank(buyer);
        router.buy{value: gross}(address(token), buyer, 0, block.timestamp);
        assertEq(uint8(curve.phase()), uint8(IBondingCurve.Phase.ReadyToGraduate), "not ready");
    }

    /// @dev Pull (wethInPosition, wethDust, gradFee) out of the migrator's Graduated log.
    function _decodeGraduated() internal returns (GradResult memory r) {
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i = 0; i < logs.length; ++i) {
            if (
                logs[i].emitter == address(migrator) && logs[i].topics.length == 4 && logs[i].topics[0] == GRADUATED_SIG
            ) {
                (, r.wethInPos,, r.gradFee,,,, r.wethDust) =
                    abi.decode(logs[i].data, (uint128, uint256, uint256, uint256, address, uint256, uint256, uint256));
                return r;
            }
        }
        revert("no Graduated log");
        // solhint-disable-previous-line reason-string
    }
}

/// @notice Ordering A — WETH etched at the MAXIMUM address: every CREATE2 subject token sorts below
///         it ⇒ launch token is token0 (the mint's WETH min is amount1Min).
contract MigratorDonationFreezeToken0Test is MigratorDonationFreezeBase {
    function _wethAt() internal pure override returns (address) {
        return address(type(uint160).max);
    }

    function _expectToken0() internal pure override returns (bool) {
        return true;
    }
}

/// @notice Ordering B — WETH etched at a tiny address: every subject token sorts above it ⇒ launch
///         token is token1 (the mint's WETH min is amount0Min).
contract MigratorDonationFreezeToken1Test is MigratorDonationFreezeBase {
    function _wethAt() internal pure override returns (address) {
        return address(0x1001);
    }

    function _expectToken0() internal pure override returns (bool) {
        return false;
    }
}
