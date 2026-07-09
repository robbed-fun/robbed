// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {CommonBase} from "forge-std/Base.sol";
import {StdAssertions} from "forge-std/StdAssertions.sol";
import {StdCheats} from "forge-std/StdCheats.sol";
import {StdUtils} from "forge-std/StdUtils.sol";

import {IBondingCurve} from "src/interfaces/IBondingCurve.sol";
import {ILaunchToken} from "src/interfaces/ILaunchToken.sol";
import {IRouter} from "src/interfaces/IRouter.sol";
import {IV3Migrator} from "src/interfaces/IV3Migrator.sol";
import {INonfungiblePositionManager} from "src/interfaces/external/INonfungiblePositionManager.sol";
import {IUniswapV3Pool} from "src/interfaces/external/IUniswapV3Pool.sol";
import {IUniswapV3SwapCallback} from "src/interfaces/external/IUniswapV3SwapCallback.sol";
import {IWETH9} from "src/interfaces/external/IWETH9.sol";

/// @title PoolGriefHandler — adversarial handler for the pre-seed-defense invariant
///        (spec §6.3.2, §10 gate 2; contracts.md §6 test matrix row 6)
/// @notice TESTS-AS-SPEC SKELETON. Fuzzes the documented griefing families against the
///         pre-initialized, near-empty graduation pool BEFORE graduate() runs:
///         (a) token/WETH donations via direct transfer,
///         (b) sync-style balance inflation,
///         (c) price-limited swaps in both directions,
///         (d) attacker-minted concentrated positions at hostile ticks.
///         Then drives the curve to the graduation edge and calls graduate(), recording whether
///         the migrator minted outside tolerance (must NEVER happen) or reverted cleanly with the
///         curve left retriable.
/// @dev Implements IUniswapV3SwapCallback so the attacker can call pool.swap directly, paying
///      from its own balances. All actions early-return until M1 wires `wired = true`.
contract PoolGriefHandler is CommonBase, StdAssertions, StdCheats, StdUtils, IUniswapV3SwapCallback {
    // ─────────────────────────── System under test ────────────────────────────
    IRouter public router;
    IBondingCurve public curve;
    ILaunchToken public token;
    IV3Migrator public migrator;
    IUniswapV3Pool public pool; // pre-created + initialized at token-creation time (spec §6.3.2)
    IWETH9 public weth;
    INonfungiblePositionManager public npm;
    address public vault;

    bool public wired;
    address public attacker;

    // ─────────────────── Ghost state (contracts.md §6 row 6) ──────────────────
    /// @notice MUST remain false forever: set if Graduated fired while the pool tick at mint time
    ///         was outside target ± TOLERANCE_TICKS (the hostile-ratio mint).
    bool public ghost_mintedOutsideTolerance;
    /// @notice True once graduate() has succeeded.
    bool public ghost_graduated;
    /// @notice Pool tick observed immediately after the successful migration mint.
    int24 public ghost_tickAtMint;
    /// @notice True if a failed graduate() left the curve in any phase other than
    ///         ReadyToGraduate/Trading (stranded = liveness violation).
    bool public ghost_curveStranded;

    constructor() {
        attacker = makeAddr("poolGriefer");
        // ── M1 WIRING (PENDING IMPLEMENTATION) ─────────────────────────────────
        // Same stack as CurveHandler._deployStack() (real V3 bytecode locally), plus:
        //   - resolve `pool` from the TokenCreated event / factory return;
        //   - fund `attacker` with ETH, WETH, and curve-bought tokens.
    }

    modifier onlyWired() {
        if (!wired) return;
        _;
    }

    modifier asAttacker() {
        vm.startPrank(attacker);
        _;
        vm.stopPrank();
    }

    // ───────────────────── Griefing actions (spec §6.3.2) ─────────────────────

    /// @notice (a) Donate launch tokens directly to the near-empty pool.
    function donateTokensToPool(uint256 amount) external onlyWired asAttacker {
        uint256 bal = token.balanceOf(attacker);
        if (bal == 0) return;
        amount = bound(amount, 1, bal);
        token.transfer(address(pool), amount);
    }

    /// @notice (a) Donate WETH directly to the pool.
    function donateWethToPool(uint256 amount) external onlyWired asAttacker {
        amount = bound(amount, 1 wei, 50 ether);
        vm.deal(attacker, attacker.balance + amount);
        weth.deposit{value: amount}();
        weth.transfer(address(pool), amount);
    }

    /// @notice (b) Sync-style balance inflation: V3 has no sync(), so the analog is inflating
    ///         both pool balances at once before any liquidity exists — distinct from (a) in that
    ///         it targets both sides to skew any balance-derived assumption.
    function syncStyleInflate(uint256 tokenAmount, uint256 wethAmount) external onlyWired asAttacker {
        uint256 bal = token.balanceOf(attacker);
        if (bal == 0) return;
        tokenAmount = bound(tokenAmount, 1, bal);
        wethAmount = bound(wethAmount, 1 wei, 50 ether);
        vm.deal(attacker, attacker.balance + wethAmount);
        weth.deposit{value: wethAmount}();
        token.transfer(address(pool), tokenAmount);
        weth.transfer(address(pool), wethAmount);
    }

    /// @notice (c) Price-limited swap griefing in either direction (moves slot0 of the near-empty
    ///         pool arbitrarily far for almost nothing).
    function swapGrief(bool zeroForOne, uint128 amountIn, uint160 sqrtPriceLimitX96) external onlyWired asAttacker {
        if (amountIn == 0) return;
        try pool.swap(attacker, zeroForOne, int256(uint256(amountIn)), sqrtPriceLimitX96, "") {
        // price moved; migrate() must arb it back before minting (contracts.md §3.4 step 5)
        }
            catch {
            // invalid limit vs current price — legal no-op
        }
    }

    /// @notice (d) Attacker-minted concentrated liquidity at hostile ticks (forces the arb-back
    ///         loop to actually consume budget rather than gliding through empty ticks).
    function mintHostilePosition(int24 tickLower, int24 tickUpper, uint256 amount0, uint256 amount1)
        external
        onlyWired
        asAttacker
    {
        // M1: bound ticks to spacing-200 multiples inside the full range, approve npm, then
        // npm.mint(MintParams({... recipient: attacker ...})) with try/catch.
        tickLower;
        tickUpper;
        amount0;
        amount1;
    }

    // ───────────────────────── Graduation attempt ─────────────────────────────

    /// @notice Fill the curve to GRADUATION_ETH and call graduate(); record the row-6 outcome.
    /// @dev Outcome taxonomy (contracts.md §6 row 6): either Graduated with the pool tick within
    ///      target ± TOLERANCE_TICKS (and position value ratio at target), or a clean
    ///      PoolPriceUnrecoverable revert with the curve retriable. NEVER a mint outside
    ///      tolerance.
    function fillAndGraduate() external onlyWired asAttacker {
        if (curve.phase() == IBondingCurve.Phase.Trading) {
            (,, uint256 realEth,) = curve.reserves();
            uint256 remainingNet = curve.GRADUATION_ETH() - realEth;
            if (remainingNet > 0) {
                uint256 denom = 10_000 - curve.TRADE_FEE_BPS();
                uint256 gross = (remainingNet * 10_000 + denom - 1) / denom;
                vm.deal(attacker, attacker.balance + gross);
                try router.buy{value: gross}(address(token), attacker, 0, block.timestamp) returns (uint256) {}
                catch {
                    return; // caps/anti-sniper blocked the fill this round
                }
            }
        }
        if (curve.phase() != IBondingCurve.Phase.ReadyToGraduate) return;

        try curve.graduate() {
            ghost_graduated = true;
            (, int24 tickAfter,,,,,) = pool.slot0();
            ghost_tickAtMint = tickAfter;
            int24 target = targetTick();
            int24 tol = migrator.TOLERANCE_TICKS();
            if (tickAfter > target + tol || tickAfter < target - tol) {
                ghost_mintedOutsideTolerance = true; // row-6 violation — invariant will fail
            }
        } catch {
            // Clean revert (PoolPriceUnrecoverable / ArbBudgetExceeded): curve must be retriable.
            IBondingCurve.Phase p = curve.phase();
            if (p != IBondingCurve.Phase.ReadyToGraduate && p != IBondingCurve.Phase.Trading) {
                ghost_curveStranded = true;
            }
        }
    }

    // ─────────────────────────────── Callbacks ────────────────────────────────

    /// @inheritdoc IUniswapV3SwapCallback
    /// @dev Attacker pays swap debts from its own balances (griefing is strictly money-losing
    ///      for the attacker — contracts.md §3.4 step 5).
    function uniswapV3SwapCallback(int256 amount0Delta, int256 amount1Delta, bytes calldata) external {
        require(msg.sender == address(pool), "callback: not pool");
        address token0 = pool.token0();
        address token1 = pool.token1();
        if (amount0Delta > 0) _pay(token0, uint256(amount0Delta));
        if (amount1Delta > 0) _pay(token1, uint256(amount1Delta));
    }

    function _pay(address asset, uint256 amount) internal {
        if (asset == address(weth)) {
            vm.deal(address(this), address(this).balance + amount);
            weth.deposit{value: amount}();
            weth.transfer(msg.sender, amount);
        } else {
            vm.startPrank(attacker);
            ILaunchToken(asset).transfer(msg.sender, amount);
            vm.stopPrank();
        }
    }

    /// @notice Deterministic graduation-price tick for the subject token's ordering
    ///         (contracts.md §2.5: token < WETH ⇒ token0 constants).
    function targetTick() public view returns (int24) {
        return address(token) < address(weth) ? migrator.TARGET_TICK_TOKEN0() : migrator.TARGET_TICK_TOKEN1();
    }
}
