// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {Test} from "forge-std/Test.sol";
import {IArbSys} from "src/interfaces/external/IArbSys.sol";

/// @title Gate-3 fork tests — full lifecycle against live Robinhood Chain (chain ID 4663)
///        (spec §10 gate 3; contracts.md §6 "Gate 3 — fork tests")
/// @notice Run with: forge test --match-path 'test/fork/*' --fork-url $ROBINHOOD_RPC
///         Addresses come from tools/m0/constants.json `external` (real V3 Factory/NPM — open
///         item O-4, never invented; real WETH; treasury Safe — O-6). NO MockArbSys here: fork
///         tests use the REAL precompile path (contracts.md §6 preamble).
contract LifecycleForkTest is Test {
    /// @notice Canonical WETH on Robinhood Chain (spec §2 chain facts).
    address internal constant WETH = 0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73;

    /// @notice ArbSys precompile — real on fork, mocked only in unit/fuzz/invariant suites.
    IArbSys internal constant ARB_SYS = IArbSys(address(100));

    function setUp() public {
        // M1: vm.createSelectFork(vm.envString("ROBINHOOD_RPC_URL")); skip cleanly when unset.
    }

    /// @notice GATE-3 LIFECYCLE (contracts.md §6): create → trade → graduate → collect against
    ///         the real V3 factory/NPM and real WETH 0x0Bd7…AD73.
    function test_fork_fullLifecycle() public {
        vm.skip(true); // PENDING IMPLEMENTATION (M1) — stages below are the ratified sequence.

        // ── Stage 0: config ────────────────────────────────────────────────────
        // Read tools/m0/constants.json (schema contracts.md §4): curve constants, fees,
        // anti-sniper, v3 sqrtPrice/tick targets, `external` addresses. Fail fast on the
        // consistency assertions (supply split == 1B; graduation reachability; sqrtPrice ==
        // tick-aligned curve spot at graduation) and require(external.weth == WETH).

        // ── Stage 1: deploy stack (deploy order contracts.md §7.2) ─────────────
        // LPFeeVault(NPM, treasurySafe) → CurveFactory(...) → V3Migrator(...) → Router(factory)
        // → factory.setMigrator / factory.setRouter (one-time setters).

        // ── Stage 2: create ────────────────────────────────────────────────────
        // router.createToken{value: creationFee + initialBuy}(...) — assert:
        // TokenCreated(..., metadataHash, metadataUri, pool) emitted (spec §12.15);
        // pool exists on the REAL v3Factory + slot0 initialized at the target sqrtPrice
        // (pre-seed defense, spec §6.3.2); token.metadataHash() matches.

        // ── Stage 3: trade ─────────────────────────────────────────────────────
        // Fuzz-light buy/sell sequence via Router: Trade events carry gross ETH + fee +
        // post-trade reserves (spec §12.15); reserves continuity; anti-sniper window respected
        // on the live-timestamp chain.

        // ── Stage 4: pollute the real pool ─────────────────────────────────────
        // Swap-grief the pre-graduation pool (donation + price-limited swap) so Stage 5
        // exercises the arb-back against REAL tick math (spec §6.3.2).

        // ── Stage 5: graduate ──────────────────────────────────────────────────
        // Fill to GRADUATION_ETH (clamped final buy, refund asserted) → permissionless
        // graduate() from a third address (caller reward asserted) → assert: arb-back landed
        // |tick − target| ≤ TOLERANCE_TICKS; NPM.mint full-range; LP NFT ownerOf == LPFeeVault;
        // token dust at 0x…dEaD; WETH dust at treasury (spec §12.13); Graduated emitted; curve
        // holds zero value.

        // ── Stage 6: generate fees ─────────────────────────────────────────────
        // Swap back and forth on the graduated pool to accrue 1%-tier fees on our LP position.

        // ── Stage 7: collect ───────────────────────────────────────────────────
        // vault.collect(tokenId) from an arbitrary address — assert treasury WETH (+token)
        // balance delta equals NPM-reported tokensOwed; FeesCollected emitted (spec §6.3.4).
    }

    /// @notice Real-ArbSys smoke test (contracts.md §6 gate 3): arbBlockNumber() > 0 and
    ///         monotonic across blocks — the precompile path the no-L1-block-numbers rule
    ///         (spec §2) depends on.
    function test_fork_arbSysSmoke() public {
        vm.skip(true); // PENDING IMPLEMENTATION (M1) — requires ROBINHOOD_RPC fork.
        uint256 first = ARB_SYS.arbBlockNumber();
        assertGt(first, 0, "gate 3: arbBlockNumber() must be non-zero on the live chain");
        // M1: roll the fork forward (or re-fork at a later block) and assert monotonicity:
        // assertGe(ARB_SYS.arbBlockNumber(), first);
    }
}
