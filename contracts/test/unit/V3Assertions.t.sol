// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {Test} from "forge-std/Test.sol";
import {V3Assertions} from "../../script/lib/V3Assertions.sol";

/// @dev Minimal mock exposing only `feeAmountTickSpacing(uint24)` — selector-level dispatch is all
///      `V3Assertions` needs (it casts the address to `IUniswapV3Factory` and calls that one fn).
///
///      M1-1 F-1 hardening (audit 2026-07-10): the mock is fee-arg-SENSITIVE. A real V3 Factory
///      returns a non-zero tick spacing ONLY for an ENABLED fee tier and 0 for every other fee. The
///      earlier mock returned `_tickSpacing` for ANY fee, so a `V3Assertions.V3_FEE_TIER` mutation
///      (querying a fee other than the 1% tier) still got 200 back and the mutant SURVIVED the pass
///      test. By enabling only the 1% tier (10000), a mutated tier now resolves to spacing 0 →
///      `assertV3Wiring` reverts → the `test_correctWiring_passes` case fails → the mutant is KILLED.
contract MockV3Factory {
    int24 internal immutable _tickSpacing;
    /// @dev The only fee tier this mock treats as enabled — the 1% graduation tier.
    uint24 internal constant ENABLED_FEE = 10_000;

    constructor(int24 tickSpacing_) {
        _tickSpacing = tickSpacing_;
    }

    function feeAmountTickSpacing(uint24 fee) external view returns (int24) {
        return fee == ENABLED_FEE ? _tickSpacing : int24(0);
    }
}

/// @dev Minimal mock exposing the two `IPeripheryImmutableState` getters the library reads.
///      `public immutable` auto-generates the `factory()` / `WETH9()` getters with matching selectors.
contract MockNPM {
    address public immutable factory;
    address public immutable WETH9;

    constructor(address factory_, address weth9_) {
        factory = factory_;
        WETH9 = weth9_;
    }
}

/// @dev External wrapper so `vm.expectRevert` observes the (otherwise inlined) internal-library revert
///      across a real CALL boundary.
contract V3AssertHarness {
    function check(address v3Factory, address npm, address weth) external view {
        V3Assertions.assertV3Wiring(v3Factory, npm, weth);
    }
}

/// @title V3AssertionsTest — proves the deploy-time V3 runtime assertions (contracts.md)
/// @notice Exercises the helper against mocked returns: the all-correct case passes, and each of the
///         three wrong-address/wrong-config cases reverts with its specific custom error. This is the
///         standalone proof that M1-14's `Deploy.s.sol` canary will fail closed on a wrong 4663 address.
contract V3AssertionsTest is Test {
    /// @dev Canonical WETH9 on chain 4663 (/ CLAUDE.md chain facts).
    address internal constant WETH = 0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73;

    V3AssertHarness internal harness;

    function setUp() public {
        harness = new V3AssertHarness();
    }

    // ── pass case ─────────────────────────────────────────────────────────────

    /// @notice Correct wiring (1% tier == 200, NPM.factory()==factory, NPM.WETH9()==WETH) does not revert.
    function test_passesOnCorrectWiring() public {
        address factory = address(new MockV3Factory(200));
        address npm = address(new MockNPM(factory, WETH));
        harness.check(factory, npm, WETH); // must not revert
    }

    // ── M1-1 F-1: mock is fee-arg-sensitive (kills a V3_FEE_TIER mutation) ────────

    /// @notice Pins the F-1 hardening: the mock returns the configured spacing ONLY for the enabled
    ///         1% tier (10000) and 0 for every other fee — mirroring a real Factory. This is precisely
    ///         what makes a `V3Assertions.V3_FEE_TIER` mutation lethal: a mutated tier queries a
    ///         disabled fee, gets spacing 0, and `assertV3Wiring` reverts, so `test_passesOnCorrectWiring`
    ///         would fail and kill the mutant. A fee-INSENSITIVE mock returned 200 for any fee and let
    ///         the mutant survive. If this ever regresses to fee-insensitivity, the asserts below break.
    function test_mockFactory_isFeeArgSensitive() public {
        MockV3Factory f = new MockV3Factory(200);
        assertEq(f.feeAmountTickSpacing(10_000), int24(200), "enabled 1% tier must return the configured spacing");
        // Any other fee tier is disabled (0) — a mutated V3_FEE_TIER lands here and reverts the assert.
        assertEq(f.feeAmountTickSpacing(10_001), int24(0), "off-by-one tier must be disabled");
        assertEq(f.feeAmountTickSpacing(9999), int24(0), "off-by-one tier must be disabled");
        assertEq(f.feeAmountTickSpacing(3000), int24(0), "0.3% tier disabled in this mock");
        assertEq(f.feeAmountTickSpacing(500), int24(0), "0.05% tier disabled in this mock");
        assertEq(f.feeAmountTickSpacing(0), int24(0), "fee 0 disabled");
    }

    // ── revert: 1% tier not enabled ──────────────────────────────────────────

    /// @notice Wrong tick spacing for the 1% tier reverts `FeeTierNotEnabled`.
    function test_revertsOnWrongTickSpacing() public {
        address factory = address(new MockV3Factory(60)); // 0.3%-tier spacing, not 200
        address npm = address(new MockNPM(factory, WETH));
        vm.expectRevert(abi.encodeWithSelector(V3Assertions.FeeTierNotEnabled.selector, int24(200), int24(60)));
        harness.check(factory, npm, WETH);
    }

    /// @notice A disabled 1% tier (returns 0) reverts `FeeTierNotEnabled` too.
    function test_revertsOnDisabledFeeTier() public {
        address factory = address(new MockV3Factory(0)); // tier disabled
        address npm = address(new MockNPM(factory, WETH));
        vm.expectRevert(abi.encodeWithSelector(V3Assertions.FeeTierNotEnabled.selector, int24(200), int24(0)));
        harness.check(factory, npm, WETH);
    }

    // ── revert: NPM.factory() mismatch ───────────────────────────────────────

    /// @notice NPM wired to a different Factory reverts `NpmFactoryMismatch`.
    function test_revertsOnNpmFactoryMismatch() public {
        address factory = address(new MockV3Factory(200));
        address otherFactory = address(0xBEEF);
        address npm = address(new MockNPM(otherFactory, WETH));
        vm.expectRevert(abi.encodeWithSelector(V3Assertions.NpmFactoryMismatch.selector, factory, otherFactory));
        harness.check(factory, npm, WETH);
    }

    // ── revert: NPM.WETH9() mismatch ─────────────────────────────────────────

    /// @notice NPM wired to a non-canonical WETH reverts `NpmWeth9Mismatch`.
    function test_revertsOnNpmWeth9Mismatch() public {
        address factory = address(new MockV3Factory(200));
        address wrongWeth = address(0xCAFE);
        address npm = address(new MockNPM(factory, wrongWeth));
        vm.expectRevert(abi.encodeWithSelector(V3Assertions.NpmWeth9Mismatch.selector, WETH, wrongWeth));
        harness.check(factory, npm, WETH);
    }

    // ── fuzz: any wrong tick spacing (except 200) reverts ────────────────────

    /// @notice ∀ tickSpacing != 200, the helper reverts `FeeTierNotEnabled` — never silently passes.
    function testFuzz_revertsOnAnyNon200TickSpacing(int24 tickSpacing) public {
        vm.assume(tickSpacing != 200);
        address factory = address(new MockV3Factory(tickSpacing));
        address npm = address(new MockNPM(factory, WETH));
        vm.expectRevert(abi.encodeWithSelector(V3Assertions.FeeTierNotEnabled.selector, int24(200), tickSpacing));
        harness.check(factory, npm, WETH);
    }
}
