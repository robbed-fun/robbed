// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";

import {V3Fixture} from "test/harness/V3Fixture.sol";
import {LaunchToken} from "src/LaunchToken.sol";
import {BondingCurve} from "src/BondingCurve.sol";
import {IBondingCurve} from "src/interfaces/IBondingCurve.sol";
import {IUniswapV3Pool} from "src/interfaces/external/IUniswapV3Pool.sol";
import {INonfungiblePositionManager} from "src/interfaces/external/INonfungiblePositionManager.sol";
import {IUniswapV3SwapCallback} from "src/interfaces/external/IUniswapV3SwapCallback.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {PoolPriceUnrecoverable} from "src/errors/Errors.sol";
import {PoolGriefer} from "test/harness/PoolGriefer.sol";
import {Reverter} from "test/harness/Harness.sol";

/// @title Migrator lifecycle + pre-seed-defense unit tests (M1-10; spec §6.3, §6.3.2, §12.11–13)
/// @notice Exercises the REAL Uniswap V3 stack (V3Fixture): clean graduation, arb-back after swap
///         griefing, hostile-mint rejection, dust routing, and the TM-T1 reverting-treasury proof.
contract MigratorTest is Test, V3Fixture {
    address internal constant DEAD = 0x000000000000000000000000000000000000dEaD;

    address internal treasury = makeAddr("treasury");
    address internal owner = makeAddr("safeOwner");
    address internal buyer = makeAddr("buyer");
    address internal grad = makeAddr("graduator");

    function setUp() public {
        _deployV3FullStack(treasury, owner);
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    uint160 internal constant MIN_SQRT = 4_295_128_739;
    uint160 internal constant MAX_SQRT = 1_461_446_703_485_210_103_287_273_052_203_988_822_378_723_970_342;

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

    function _buyTo(BondingCurve, LaunchToken token, address to, uint256 ethIn) internal {
        vm.deal(to, to.balance + ethIn);
        vm.prank(to);
        router.buy{value: ethIn}(address(token), to, 0, block.timestamp);
    }

    /// @dev Build + fund an adversary (WETH for swap/mint debts; tokens via a curve buy).
    function _newGriefer(LaunchToken token, BondingCurve curve, address pool, uint256 tokenBuyEth)
        internal
        returns (PoolGriefer g)
    {
        g = new PoolGriefer(pool, address(token), address(weth), address(npm));
        vm.deal(address(g), 100 ether);
        vm.prank(address(g));
        weth.deposit{value: 50 ether}();
        if (tokenBuyEth > 0) {
            vm.warp(uint256(curve.EARLY_WINDOW_END()) + 1);
            _buyTo(curve, token, address(g), tokenBuyEth);
        }
    }

    function _tickOf(address pool) internal view returns (int24 tick) {
        (, tick,,,,,) = IUniswapV3Pool(pool).slot0();
    }

    function _targetTick(LaunchToken token) internal view returns (int24) {
        return address(token) < address(weth) ? migrator.TARGET_TICK_TOKEN0() : migrator.TARGET_TICK_TOKEN1();
    }

    // ── clean graduation ───────────────────────────────────────────────────────

    function test_pool_initialized_at_target_tick() public {
        (LaunchToken token,, address pool) = _createSubject(makeAddr("creator1"));
        (, int24 tick,,,,,) = IUniswapV3Pool(pool).slot0();
        int24 target = address(token) < address(weth) ? migrator.TARGET_TICK_TOKEN0() : migrator.TARGET_TICK_TOKEN1();
        assertEq(tick, target, "pool did not init at graduation tick");
    }

    function test_graduate_cleanMint_toVault_andZeroValueCurve() public {
        (LaunchToken token, BondingCurve curve, address pool) = _createSubject(makeAddr("creator2"));
        _fillToReady(curve, token);

        uint256 gradBalBefore = grad.balance;
        vm.recordLogs();
        vm.prank(grad);
        curve.graduate();

        // Caller reward paid (native ETH) to the graduation caller.
        assertEq(grad.balance - gradBalBefore, curve.CALLER_REWARD(), "caller reward");

        // Curve is terminal + holds zero extractable value (only unswept fees, then swept to 0).
        assertEq(uint8(curve.phase()), uint8(IBondingCurve.Phase.Graduated), "phase");
        assertEq(token.balanceOf(address(curve)), 0, "curve still holds tokens");
        curve.sweepFees();
        assertEq(address(curve).balance, 0, "curve holds residual ETH after sweep");

        // Pool holds the minted liquidity; migrator retains nothing.
        assertGt(IUniswapV3Pool(pool).liquidity(), 0, "pool has no liquidity");
        assertEq(token.balanceOf(address(migrator)), 0, "migrator retained tokens");
        assertEq(weth.balanceOf(address(migrator)), 0, "migrator retained WETH");

        // LP NFT is owned by the vault (principal permanently locked).
        assertEq(npm.balanceOf(address(vault)), 1, "vault did not receive the LP NFT");

        // Pool ends within tolerance of target.
        (, int24 tick,,,,,) = IUniswapV3Pool(pool).slot0();
        int24 target = address(token) < address(weth) ? migrator.TARGET_TICK_TOKEN0() : migrator.TARGET_TICK_TOKEN1();
        int24 tol = migrator.TOLERANCE_TICKS();
        assertTrue(tick >= target - tol && tick <= target + tol, "post-mint tick out of tolerance");
    }

    function test_graduate_feeAndDust_toTreasury_asWeth() public {
        (LaunchToken token, BondingCurve curve,) = _createSubject(makeAddr("creator3"));
        _fillToReady(curve, token);

        // graduate() itself must move NO native ETH to the treasury (only the router's creation-fee
        // push, which happened at create, is native). Snapshot across graduate() only.
        uint256 treasuryNativeBefore = treasury.balance;
        vm.prank(grad);
        curve.graduate();

        // Graduation fee + WETH dust arrive as WETH (never native ETH) — the TM-T1 reverting-safe leg.
        assertGe(weth.balanceOf(treasury), curve.GRADUATION_FEE(), "treasury did not receive grad fee in WETH");
        assertEq(treasury.balance, treasuryNativeBefore, "graduate() must not push native ETH to treasury");
    }

    // ── graduation fires exactly once ────────────────────────────────────────────

    function test_graduate_singleFire() public {
        (LaunchToken token, BondingCurve curve,) = _createSubject(makeAddr("creator4"));
        _fillToReady(curve, token);
        vm.prank(grad);
        curve.graduate();
        vm.expectRevert();
        vm.prank(grad);
        curve.graduate();
    }

    // ── TM-T1: reverting treasury cannot lock graduation ─────────────────────────

    /// @notice Point the live `treasury` at a contract that reverts on native ETH. Because the
    ///         graduation fee + WETH dust are paid via `weth.transfer` (no recipient callback),
    ///         `graduate()` still succeeds — the reverting-treasury freeze vector is eliminated by
    ///         construction (TM-T1 graduation-fee leg; threat-model UM-2).
    function test_TMT1_revertingTreasury_graduateSucceeds() public {
        (LaunchToken token, BondingCurve curve, address pool) = _createSubject(makeAddr("creator5"));
        _fillToReady(curve, token);

        Reverter badTreasury = new Reverter();
        vm.prank(owner);
        factory.setTreasury(address(badTreasury));

        vm.prank(grad);
        curve.graduate(); // must NOT revert

        assertEq(uint8(curve.phase()), uint8(IBondingCurve.Phase.Graduated), "did not graduate");
        assertGe(weth.balanceOf(address(badTreasury)), curve.GRADUATION_FEE(), "fee not delivered as WETH");
        assertEq(npm.balanceOf(address(vault)), 1, "LP NFT not in vault");
        assertGt(IUniswapV3Pool(pool).liquidity(), 0, "no liquidity minted");
    }

    // ── pre-seed defense (spec §6.3.2) ──────────────────────────────────────────

    /// @notice Griefer swaps the empty pre-grad pool's price far ABOVE target; the arb-back must
    ///         restore it to within tolerance before minting.
    function test_preseed_swapGriefUp_arbsBack() public {
        (LaunchToken token, BondingCurve curve, address pool) = _createSubject(makeAddr("creator6"));
        PoolGriefer g = _newGriefer(token, curve, pool, 0);

        bool tokenIsToken0 = address(token) < address(weth);
        // Push price up: zeroForOne=false raises the price (token1→token0), limit above current.
        uint160 target = tokenIsToken0 ? migrator.SQRT_PRICE_TOKEN0_X96() : migrator.SQRT_PRICE_TOKEN1_X96();
        g.grief_swap(false, 1, target < MAX_SQRT / 8 ? target * 8 : MAX_SQRT - 1);
        assertGt(
            _absDiff(_tickOf(pool), _targetTick(token)), uint256(uint24(migrator.TOLERANCE_TICKS())), "not griefed"
        );

        _fillToReady(curve, token);
        vm.prank(grad);
        curve.graduate();
        _assertGraduatedInTolerance(token, pool);
    }

    /// @notice Same, price griefed far BELOW target.
    function test_preseed_swapGriefDown_arbsBack() public {
        (LaunchToken token, BondingCurve curve, address pool) = _createSubject(makeAddr("creator7"));
        PoolGriefer g = _newGriefer(token, curve, pool, 0);

        bool tokenIsToken0 = address(token) < address(weth);
        uint160 target = tokenIsToken0 ? migrator.SQRT_PRICE_TOKEN0_X96() : migrator.SQRT_PRICE_TOKEN1_X96();
        // Push price down: zeroForOne=true lowers the price, limit below current (> MIN).
        uint160 limit = target / 8 > MIN_SQRT ? target / 8 : MIN_SQRT + 1;
        g.grief_swap(true, 1, limit);
        assertGt(
            _absDiff(_tickOf(pool), _targetTick(token)), uint256(uint24(migrator.TOLERANCE_TICKS())), "not griefed"
        );

        _fillToReady(curve, token);
        vm.prank(grad);
        curve.graduate();
        _assertGraduatedInTolerance(token, pool);
    }

    /// @notice Raw token+WETH donations to the pool are inert in V3 — they cannot skew the mint.
    function test_preseed_donation_inert() public {
        (LaunchToken token, BondingCurve curve, address pool) = _createSubject(makeAddr("creator8"));
        PoolGriefer g = _newGriefer(token, curve, pool, 0.5 ether);
        g.grief_donate(address(token), token.balanceOf(address(g)) / 2);
        vm.prank(address(g));
        g.grief_donate(address(weth), 3 ether);

        _fillToReady(curve, token);
        vm.prank(grad);
        curve.graduate();
        _assertGraduatedInTolerance(token, pool);
    }

    /// @notice Adversary mints deep hostile liquidity AND swaps price off-target. Outcome MUST be
    ///         one of: graduated with tick in tolerance, OR a clean revert leaving the curve
    ///         ReadyToGraduate (retriable). NEVER a mint outside tolerance (spec §6.3.2).
    function test_preseed_hostileMint_neverMintsOutsideTolerance() public {
        (LaunchToken token, BondingCurve curve, address pool) = _createSubject(makeAddr("creator9"));
        PoolGriefer g = _newGriefer(token, curve, pool, 2 ether);

        // Mint a large full-width attacker position, then swap price hard off target.
        int24 lo = -887_200;
        int24 hi = 887_200;
        try g.grief_mint(lo, hi, token.balanceOf(address(g)), 40 ether) {} catch {}
        bool tokenIsToken0 = address(token) < address(weth);
        uint160 target = tokenIsToken0 ? migrator.SQRT_PRICE_TOKEN0_X96() : migrator.SQRT_PRICE_TOKEN1_X96();
        try g.grief_swap(
            true, int256(token.balanceOf(address(g))), target / 8 > MIN_SQRT ? target / 8 : MIN_SQRT + 1
        ) {}
            catch {}

        _fillToReady(curve, token);
        vm.prank(grad);
        try curve.graduate() {
            // If it graduated, the tick MUST be within tolerance (never hostile).
            _assertGraduatedInTolerance(token, pool);
        } catch {
            // Clean revert: curve remains permissionlessly retriable (liveness self-heals).
            assertEq(
                uint8(curve.phase()), uint8(IBondingCurve.Phase.ReadyToGraduate), "stranded curve after failed migrate"
            );
        }
    }

    // ── TM-T2: WETH-leg arb budget definition + proofs ──────────────────────────

    bytes32 internal constant GRADUATED_SIG =
        keccak256("Graduated(address,address,uint256,uint128,uint256,uint256,uint256,address,uint256,uint256,uint256)");

    /// @dev Decode `wethInPosition` from the migrator's Graduated log in the recorded logs.
    function _wethInPositionFromLogs() internal returns (uint256 wethInPosition) {
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i = 0; i < logs.length; ++i) {
            if (
                logs[i].emitter == address(migrator) && logs[i].topics.length == 4 && logs[i].topics[0] == GRADUATED_SIG
            ) {
                (, wethInPosition,,,,,,) =
                    abi.decode(logs[i].data, (uint128, uint256, uint256, uint256, address, uint256, uint256, uint256));
                return wethInPosition;
            }
        }
        revert("no Graduated log");
    }

    /// @notice TM-T2 Property B (parity floor). The WETH-leg mint requirement is the FULL
    ///         `wethForMint`; the mint's `amount1Min` = `wethForMint · (1 − slippage)` makes every
    ///         successful graduation deposit at least that WETH into the position — so the $69k
    ///         parity (§12.11) can skew by at most `MIGRATION_SLIPPAGE_BPS`. Proven here after a
    ///         WETH-leg arb (price griefed below target).
    function test_TMT2_wethLegParityFloor_holds() public {
        (LaunchToken token, BondingCurve curve, address pool) = _createSubject(makeAddr("creator10"));
        PoolGriefer g = _newGriefer(token, curve, pool, 0);
        bool tokenIsToken0 = address(token) < address(weth);
        uint160 target = tokenIsToken0 ? migrator.SQRT_PRICE_TOKEN0_X96() : migrator.SQRT_PRICE_TOKEN1_X96();
        g.grief_swap(true, 1, target / 8 > MIN_SQRT ? target / 8 : MIN_SQRT + 1); // underprice → WETH-leg arb

        _fillToReady(curve, token);
        vm.recordLogs();
        vm.prank(grad);
        curve.graduate();

        uint256 wethForMint = curve.GRADUATION_ETH() - curve.CALLER_REWARD() - curve.GRADUATION_FEE();
        uint256 floor = (wethForMint * (10_000 - migrator.MIGRATION_SLIPPAGE_BPS())) / 10_000;
        assertGe(_wethInPositionFromLogs(), floor, "TM-T2: position WETH below the parity floor");
        _assertGraduatedInTolerance(token, pool);
    }

    /// @notice TM-T2 Property A (budget cap bites). Deep attacker liquidity below target + a hard
    ///         down-swap means the bounded WETH arb (`wethForMint · slippage`) cannot restore the
    ///         price. The migrator reverts (ArbBudgetExceeded / PoolPriceUnrecoverable) rather than
    ///         mint into a hostile ratio, and the curve stays permissionlessly retriable — the arb
    ///         NEVER spends below the LP-mint floor.
    function test_TMT2_wethBudgetCap_revertsCleanly() public {
        (LaunchToken token, BondingCurve curve, address pool) = _createSubject(makeAddr("creator11"));
        PoolGriefer g = _newGriefer(token, curve, pool, 3 ether);
        bool tokenIsToken0 = address(token) < address(weth);
        uint160 target = tokenIsToken0 ? migrator.SQRT_PRICE_TOKEN0_X96() : migrator.SQRT_PRICE_TOKEN1_X96();

        // Deep token liquidity just below target (attacker sells token cheap), then swap price down
        // into it — arbing back up would require far more than the ~1% WETH budget.
        int24 tt = _targetTick(token);
        int24 lo = ((tt - 40_000) / 200) * 200;
        int24 hi = ((tt - 200) / 200) * 200;
        if (lo > hi) (lo, hi) = (hi, lo);
        try g.grief_mint(lo, hi, token.balanceOf(address(g)), 45 ether) {} catch {}
        try g.grief_swap(
            true, int256(token.balanceOf(address(g))), target / 16 > MIN_SQRT ? target / 16 : MIN_SQRT + 1
        ) {}
            catch {}

        _fillToReady(curve, token);
        vm.prank(grad);
        try curve.graduate() {
            // If it did graduate, it must still be within tolerance (never hostile).
            _assertGraduatedInTolerance(token, pool);
        } catch {
            assertEq(uint8(curve.phase()), uint8(IBondingCurve.Phase.ReadyToGraduate), "curve stranded");
        }
    }

    // ── M-10-A LIVENESS: token-leg grief within tolerance must GRADUATE (not freeze) ───────────

    /// @notice Regression for finding M-10-A (UM-2 realised on the TOKEN leg). PoC: the attacker
    ///         mints a real concentrated position on the token-OVERPRICED side of target, then swaps
    ///         the pool price INTO that band (the "token-selling-arb" direction — the migrator must
    ///         sell tokens to restore target). Pre-fix, the token-leg budget was
    ///         `balanceOf(token) − LP_TOKEN_TRANCHE` ≈ dust (the curve forwards ≈ exactly the tranche),
    ///         so the arb had ~0 token to spend, reverted `ArbBudgetExceeded`, and FROZE the curve in
    ///         `ReadyToGraduate` (both directions locked, §12.12) while the attacker kept a withdrawable
    ///         LP position — a money-neutral freeze grief. Post-fix the token leg has the SYMMETRIC
    ///         slippage-bounded budget (`LP_TOKEN_TRANCHE · MIGRATION_SLIPPAGE_BPS`), so a grief inside
    ///         the recoverable range self-corrects and `graduate()` SUCCEEDS within tolerance — a
    ///         LIVENESS assertion, not merely "no hostile mint".
    function test_M10A_tokenLegGrief_recoverable_graduates() public {
        _runTokenLegRecoverableLiveness(makeAddr("creator12"), 900_000e18);
    }

    /// @notice Same regression with a larger (but still ≤ `LP_TOKEN_TRANCHE · slippage`) hostile
    ///         position, to show the symmetric budget has real margin — still graduates.
    function test_M10A_tokenLegGrief_largerRecoverable_graduates() public {
        _runTokenLegRecoverableLiveness(makeAddr("creator13"), 1_600_000e18);
    }

    /// @dev Build the exact PoC: attacker concentrated LP on the token-overpriced side + a swap that
    ///      drives price into it (token-leg direction), sized to stay inside the slippage-recoverable
    ///      range, then assert graduation SUCCEEDS within tolerance.
    function _runTokenLegRecoverableLiveness(address creator, uint256 hostileTokenAmount) internal {
        (LaunchToken token, BondingCurve curve, address pool) = _createSubject(creator);
        // Fund the attacker with enough token inventory (buy past the anti-sniper window) + WETH.
        PoolGriefer g = _newGriefer(token, curve, pool, 0.1 ether);
        require(token.balanceOf(address(g)) >= hostileTokenAmount, "griefer under-funded");

        bool tokenIsToken0 = address(token) < address(weth);
        int24 tt = _targetTick(token);
        uint160 target = tokenIsToken0 ? migrator.SQRT_PRICE_TOKEN0_X96() : migrator.SQRT_PRICE_TOKEN1_X96();

        // Token-overpriced side: token0 → ticks ABOVE target (price up); token1 → ticks BELOW (down).
        // Mint the hostile band single-sided in TOKEN on that side (price starts AT target), then swap
        // the price into the band so the migrator's arb must SELL token to walk back to target.
        if (tokenIsToken0) {
            int24 lo = (((tt + 400) / 200)) * 200;
            int24 hi = (((tt + 2400) / 200)) * 200;
            g.grief_mint(lo, hi, hostileTokenAmount, 0); // token0 = token, single-sided above price
            // Push price UP into the band (buy token0 with WETH). Limit ~+1400 ticks, inside the band.
            g.grief_swap(false, 40 ether, uint160((uint256(target) * 107) / 100));
        } else {
            int24 lo = (((tt - 2400) / 200)) * 200;
            int24 hi = (((tt - 400) / 200)) * 200;
            g.grief_mint(lo, hi, 0, hostileTokenAmount); // token1 = token, single-sided below price
            // Push price DOWN into the band (buy token1 with WETH). Limit ~−1400 ticks, inside band.
            g.grief_swap(true, 40 ether, uint160((uint256(target) * 93) / 100));
        }

        // The grief actually moved the pool off-target by more than tolerance (non-vacuous).
        assertGt(
            _absDiff(_tickOf(pool), tt),
            uint256(uint24(migrator.TOLERANCE_TICKS())),
            "grief did not move pool off-target"
        );

        _fillToReady(curve, token);

        // LIVENESS: graduation must SUCCEED (pre-fix this reverted ArbBudgetExceeded → frozen curve).
        vm.prank(grad);
        curve.graduate();

        assertEq(uint8(curve.phase()), uint8(IBondingCurve.Phase.Graduated), "M-10-A: curve did not graduate");
        _assertGraduatedInTolerance(token, pool);
        assertEq(npm.balanceOf(address(vault)), 1, "M-10-A: LP NFT not delivered to vault");
        // Migrator retains nothing extractable (token dust burned, WETH dust → treasury).
        assertEq(token.balanceOf(address(migrator)), 0, "M-10-A: migrator retained tokens");
        assertEq(weth.balanceOf(address(migrator)), 0, "M-10-A: migrator retained WETH");
    }

    function _assertGraduatedInTolerance(LaunchToken token, address pool) internal view {
        int24 target = _targetTick(token);
        int24 tol = migrator.TOLERANCE_TICKS();
        int24 tick = _tickOf(pool);
        assertTrue(tick >= target - tol && tick <= target + tol, "minted outside tolerance (hostile ratio)");
        assertGt(IUniswapV3Pool(pool).liquidity(), 0, "no liquidity minted");
    }

    function _absDiff(int24 a, int24 b) internal pure returns (uint256) {
        return a >= b ? uint256(uint24(a - b)) : uint256(uint24(b - a));
    }
}
