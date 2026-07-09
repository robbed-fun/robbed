// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {Test} from "forge-std/Test.sol";
import {PoolGriefHandler} from "test/invariant/handlers/PoolGriefHandler.sol";

/// @title Gate-2 invariant 6 — pre-seeded/donated/swapped V3 pool cannot cause a hostile-ratio
///        mint (spec §6.3.2, §10 gate 2; contracts.md §6 test matrix row 6)
/// @notice Dedicated adversarial campaign: before graduate(), the fuzzer drives donations
///         (token/WETH), sync-style balance inflation, price-limited swaps in both directions,
///         and attacker-minted concentrated positions at hostile ticks against the
///         pre-initialized, near-empty graduation pool. Outcome must ALWAYS be one of:
///         (a) Graduated with the final pool tick within target ± TOLERANCE_TICKS (and the
///             position value ratio at target — M1 adds the NPM.positions amounts check), or
///         (b) a clean PoolPriceUnrecoverable/ArbBudgetExceeded revert with the curve left
///             retriable (ReadyToGraduate — liveness is economically self-healing,
///             contracts.md §3.4 step 6).
///         NEVER a mint outside tolerance.
contract PoolGriefingNoHostileMintInvariant is Test {
    PoolGriefHandler internal handler;

    function setUp() public {
        handler = new PoolGriefHandler();
        targetContract(address(handler));
        // M1: set `fail_on_revert = true` for this suite.
    }

    /// @notice EXACT ASSERTIONS (contracts.md §6 row 6):
    ///         (1) never minted outside target ± TOLERANCE_TICKS;
    ///         (2) if graduated: |tickAtMint − targetTick| ≤ TOLERANCE_TICKS;
    ///         (3) failed graduations never strand the curve (still permissionlessly retriable).
    function invariant_noHostileRatioMint() public {
        vm.skip(true); // PENDING IMPLEMENTATION (M1) — remove once PoolGriefHandler wires the stack.
        assertFalse(
            handler.ghost_mintedOutsideTolerance(), "gate-2 row 6 / spec 6.3.2: migrator minted into a hostile ratio"
        );
        if (handler.ghost_graduated()) {
            int24 tick = handler.ghost_tickAtMint();
            int24 target = handler.targetTick();
            int24 tol = handler.migrator().TOLERANCE_TICKS();
            assertTrue(
                tick >= target - tol && tick <= target + tol,
                "gate-2 row 6: post-mint pool tick outside target +/- TOLERANCE_TICKS"
            );
            // M1 TODO (row 6 "position value ratio at target"): read
            // positionManager.positions(tokenId) and assert amount0:amount1 corresponds to the
            // target sqrtPrice within MIGRATION_SLIPPAGE_BPS.
        }
        assertFalse(
            handler.ghost_curveStranded(),
            "gate-2 row 6 / contracts.md 3.4: failed migration left the curve non-retriable"
        );
    }
}
