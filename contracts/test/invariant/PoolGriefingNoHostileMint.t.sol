// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {Test} from "forge-std/Test.sol";
import {PoolGriefHandler} from "test/invariant/handlers/PoolGriefHandler.sol";

/// @title Gate-2 invariant 6 — pre-seeded/donated/swapped V3 pool cannot cause a hostile-ratio
///        mint (spec §6.3.2, §10 gate 2; contracts.md §6 test matrix row 6)
/// @notice Dedicated adversarial campaign against the REAL Uniswap V3 stack: the fuzzer drives
///         donations (token/WETH), sync-style dual-side inflation, price-limited swaps in both
///         directions, and attacker-minted concentrated positions at hostile ticks against the
///         pre-initialized, near-empty graduation pool, then attempts graduation. Outcome must
///         ALWAYS be one of:
///         (a) Graduated with the final pool tick within target ± TOLERANCE_TICKS (the migrator
///             arbed the price back before minting), or
///         (b) a clean PoolPriceUnrecoverable/ArbBudgetExceeded revert with the curve left
///             retriable (ReadyToGraduate — liveness is economically self-healing).
///         NEVER a mint outside tolerance.
contract PoolGriefingNoHostileMintInvariant is Test {
    PoolGriefHandler internal handler;

    function setUp() public {
        handler = new PoolGriefHandler();
        targetContract(address(handler));
    }

    /// @notice EXACT ASSERTIONS (contracts.md §6 row 6):
    ///         (1) never minted outside target ± TOLERANCE_TICKS;
    ///         (2) if graduated: |tickAtMint − targetTick| ≤ TOLERANCE_TICKS;
    ///         (3) failed graduations never strand the curve (still permissionlessly retriable).
    /// @dev Each fuzz call runs a FULL fresh griefed lifecycle (create→grief→fill→graduate) against
    ///      the real Uniswap V3 stack, so runs/depth are bounded here (each cycle deploys a real
    ///      pool + mints a real position).
    /// forge-config: default.invariant.runs = 48
    /// forge-config: default.invariant.depth = 8
    /// forge-config: default.invariant.fail-on-revert = false
    function invariant_noHostileRatioMint() public view {
        assertFalse(
            handler.ghost_mintedOutsideTolerance(), "gate-2 row 6 / spec 6.3.2: migrator minted into a hostile ratio"
        );
        if (handler.ghost_graduated()) {
            int24 tick = handler.ghost_tickAtMint();
            int24 target = handler.ghost_targetAtMint();
            int24 tol = handler.toleranceTicks();
            assertTrue(
                tick >= target - tol && tick <= target + tol,
                "gate-2 row 6: post-mint pool tick outside target +/- TOLERANCE_TICKS"
            );
        }
        assertFalse(
            handler.ghost_curveStranded(),
            "gate-2 row 6 / contracts.md 3.4: failed migration left the curve non-retriable"
        );
    }

    /// @notice Coverage guard: the campaign must actually reach graduation on griefed pools, else
    ///         the safety invariant above would pass vacuously. The M-10-A leg additionally requires
    ///         at least one graduation that SUCCEEDED while the pool was mispriced in the TOKEN-leg
    ///         (token-selling-arb) direction — a LIVENESS assertion: pre-fix that path froze
    ///         (`ArbBudgetExceeded`, ≈0 token budget); the symmetric token-leg budget makes it
    ///         self-heal within the recoverable range (finding M-10-A / UM-2 realised).
    function afterInvariant() public view {
        assertGt(handler.ghost_cycles(), 0, "gate-2 row 6: no griefing lifecycles ran");
        assertGt(handler.ghost_graduations(), 0, "gate-2 row 6: campaign never reached a graduation (vacuous)");
        assertGt(
            handler.ghost_tokenLegLivenessGraduations(),
            0,
            "M-10-A: no token-leg-direction griefed pool ever graduated (liveness uncovered)"
        );
        // F-1: at least one real-migrator graduation must have carried an above-threshold CURVE ETH
        // donation. Pre-fix that path froze (NPM.mint "Price slippage check"); post-fix the WETH mint
        // floor is donation-invariant and the surplus surfaces as dust — proven across the campaign.
        assertGt(
            handler.ghost_curveDonationGraduations(),
            0,
            "F-1: no graduation exercised an above-threshold curve ETH donation (freeze coverage missing)"
        );
    }
}
