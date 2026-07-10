// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {Test} from "forge-std/Test.sol";
import {V3Assertions} from "../../script/lib/V3Assertions.sol";

/// @dev Minimal mock exposing only `feeAmountTickSpacing(uint24)` — selector-level dispatch is all
///      `V3Assertions` needs (it casts the address to `IUniswapV3Factory` and calls that one fn).
contract MockV3Factory {
    int24 internal immutable _tickSpacing;

    constructor(int24 tickSpacing_) {
        _tickSpacing = tickSpacing_;
    }

    function feeAmountTickSpacing(uint24) external view returns (int24) {
        return _tickSpacing;
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

/// @title V3AssertionsTest — proves the deploy-time V3 runtime assertions (contracts.md §7.2, §12.28)
/// @notice Exercises the helper against mocked returns: the all-correct case passes, and each of the
///         three wrong-address/wrong-config cases reverts with its specific custom error. This is the
///         standalone proof that M1-14's `Deploy.s.sol` canary will fail closed on a wrong 4663 address.
contract V3AssertionsTest is Test {
    /// @dev Canonical WETH9 on chain 4663 (spec §12.28 / CLAUDE.md chain facts).
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
