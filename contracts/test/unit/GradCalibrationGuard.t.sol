// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {Test} from "forge-std/Test.sol";
import {Deploy} from "../../script/Deploy.s.sol";
import {TestConstants} from "test/harness/TestConstants.sol";

/// @dev Exposes the internal calibration-relation plumbing of {Deploy} (pattern mirrors
///      unit/DeployModes.t.sol's DeployHarness). `loadFrom` runs the exact pre-broadcast
///      `_loadConstantsFrom` path (chain-id pin + `_consistencyChecks`, WITHOUT `_resolveExternals`
///      — the calibration check lives entirely inside the consistency block).
contract CalibrationHarness is Deploy {
    function covers(int24 toleranceTicks, uint16 migrationSlippageBps) external pure returns (bool) {
        return _minFloorCoversToleranceBand(toleranceTicks, migrationSlippageBps);
    }

    function powTickWad(uint256 n) external pure returns (uint256) {
        return _powTickWad(n);
    }

    function loadFrom(string memory path) external {
        mode = _selectMode(block.chainid);
        _loadConstantsFrom(path);
    }
}

/// @title GradCalibrationGuardTest — gate-4 DID mutation-disposition calibration pin
/// @notice The 14 L362/L363 min-weakening mutants (reports/mutation/README.md) are
///         equivalent-in-reachable-states ONLY while
///           `1.0001^TOLERANCE_TICKS × (1 − MIGRATION_SLIPPAGE_BPS/1e4) ≤ 1`
///         (currently 1.0001^100 × 0.99 ≈ 0.99994917, margin ≈ 0.00508%). Both parameters are
///         beta-retunable (spec §12.32/§12.33), so WITHOUT this guard a retune could silently
///         invalidate the disposition with no test failing — and, worse, let the mins bite inside
///         the L255 tolerance band (NPM amount-min revert after the tolerance check passed →
///         §12.12 ReadyToGraduate liveness risk). This suite (a) asserts the relation for the
///         live TestConstants M0 fixture, (b) proves the predicate demonstrably CATCHES bad
///         calibrations (pure-math negative pins — TestConstants itself is never touched), and
///         (c) proves the matching `Deploy._consistencyChecks` assert fails a retuned constants
///         file closed pre-broadcast.
contract GradCalibrationGuardTest is Test {
    /// @dev constants.testnet-mode.json with `v3.toleranceTicks = 200` — violates the relation.
    string internal constant FIXTURE_BAD_CALIBRATION = "test/fixtures/deploy/constants.badcalibration.json";

    /// @dev `⌈1.0001^100⌉`-style round-up WAD value the {Deploy._powTickWad} algorithm produces —
    ///      derived offline with exact integer arithmetic (python3 Fraction(10001,10000)**100,
    ///      mirroring the round-up square-and-multiply step by step). True floor is
    ///      1_010_049_662_092_876_568; the +12 wei bias is the deliberate UP direction (pass ⇒ the
    ///      true relation holds) and is 12 orders of magnitude below the ~5.08e13 wei margin.
    uint256 internal constant POW100_ROUND_UP_WAD = 1_010_049_662_092_876_580;
    uint256 internal constant POW100_TRUE_FLOOR_WAD = 1_010_049_662_092_876_568;

    string internal constant GATE4_BROKEN_MSG = "GATE-4 DID DISPOSITION INVALIDATED: 1.0001^TOLERANCE_TICKS * (1 - MIGRATION_SLIPPAGE_BPS/1e4) > 1 -- "
        "the 14x L362/L363 'DID (local-calibration; fork-confirmed unmutated-min liveness)' rows in "
        "contracts/reports/mutation/README.md no longer hold; re-open gate 4 for those mutants and re-derive "
        "TOLERANCE_TICKS / MIGRATION_SLIPPAGE_BPS (spec 12.32/12.33) before any deploy";

    CalibrationHarness internal harness;

    function setUp() public {
        harness = new CalibrationHarness();
    }

    // ── (a) the relation HOLDS for the live M0 calibration (TestConstants mirror) ──

    function test_gate4Calibration_holdsForCurrentM0Constants() public view {
        assertTrue(
            harness.covers(TestConstants.TOLERANCE_TICKS, TestConstants.MIGRATION_SLIPPAGE_BPS), GATE4_BROKEN_MSG
        );
    }

    // ── (b) failing-if-violated: the predicate catches bad calibrations ──
    // Literal-pinned pure-math negatives (never TestConstants — a legitimate retune of the fixture
    // must not break these; only test (a) tracks the live values).

    /// @dev The reviewer scenario: TOLERANCE_TICKS retuned 100 → 200 at 100 bps.
    ///      Exact: 1.0001^200 × 0.99 = 1.00999831… > 1 → the guard must flag it.
    function test_gate4Calibration_toleranceRetunedTo200_isCaught() public view {
        assertFalse(harness.covers(200, 100), "guard MUST catch toleranceTicks=200 @ 100bps (relation > 1)");
    }

    /// @dev The bound is SHARP at the 2026-07-10 M0 calibration: ONE extra tick of tolerance
    ///      already violates it (1.0001^101 × 0.99 = 1.00004916… > 1). TOLERANCE_TICKS has ZERO
    ///      upward retune headroom at 100 bps — any upward retune re-opens gate 4.
    function test_gate4Calibration_boundIsSharp_oneTickPastCurrentTolerance() public view {
        assertFalse(harness.covers(101, 100), "bound must be sharp: toleranceTicks=101 @ 100bps violates");
        assertTrue(harness.covers(100, 100), "...while the current calibration point itself holds");
    }

    /// @dev Slippage-side retune: tightening the min floor (smaller bps) below the band also
    ///      violates the relation (1.0001^100 × 0.995 = 1.00499941… > 1 at 50 bps; ×1 at 0 bps).
    function test_gate4Calibration_slippageTightened_isCaught() public view {
        assertFalse(harness.covers(100, 50), "guard MUST catch migrationSlippageBps=50 @ 100 ticks");
        assertFalse(harness.covers(100, 0), "guard MUST catch migrationSlippageBps=0 @ 100 ticks");
    }

    /// @dev Nonsense calibrations fail closed: negative tolerance, and slippage ≥ 100% (a ZERO
    ///      §6.3.2 min floor — the amount-min defense would be disabled outright).
    function test_gate4Calibration_nonsenseDomains_failClosed() public view {
        assertFalse(harness.covers(-1, 100), "negative tolerance is a miscalibration");
        assertFalse(harness.covers(100, 10_000), "slippage == 100% zeroes the min floor");
        assertFalse(harness.covers(100, type(uint16).max), "slippage > 100% must not underflow-pass");
    }

    // ── fixed-point power pins (bit-exact; derivation in the constant NatSpec above) ──

    function test_powTickWad_pins() public view {
        assertEq(harness.powTickWad(0), 1e18, "1.0001^0 == 1 WAD");
        assertEq(harness.powTickWad(1), 1.0001e18, "1.0001^1 == TICK_BASE_WAD exactly");
        assertEq(harness.powTickWad(100), POW100_ROUND_UP_WAD, "1.0001^100 round-up WAD (offline-derived pin)");
        // Bias direction is UP (one-sided safety: pass ⇒ true relation holds) and negligible.
        assertGe(harness.powTickWad(100), POW100_TRUE_FLOOR_WAD, "round-up must never undershoot the true power");
        assertLe(harness.powTickWad(100) - POW100_TRUE_FLOOR_WAD, 32, "round-up bias stays within a few wei");
    }

    // ── (c) the matching Deploy-side assert fails a retuned constants file closed ──

    function test_deploy_badCalibrationConstants_failsClosed() public {
        vm.chainId(46_630); // fixture declares chainId 46630 → passes the chain pin, fails calibration
        vm.expectRevert(abi.encodeWithSelector(Deploy.MinFloorToleranceBandViolated.selector, int24(200), uint16(100)));
        harness.loadFrom(FIXTURE_BAD_CALIBRATION);
    }
}
