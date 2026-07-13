// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {CurveFactory} from "src/CurveFactory.sol";
import {V3Migrator} from "src/V3Migrator.sol";

/// @title TestConstants — M0 economics fixture for unit/fuzz/invariant tests
/// @notice TEST-ONLY. Mirrors `tools/m0/out/constants.json` (generatedAt 2026-07-13T19:57 — the
///         §12.67/§12.68 re-derivation, retargeted 2026-07-13: MAINNET FLAT graduation target
///         G = 5.749693 ETH net-of-fee (solver-derived + tick-aligned from a flat 5.7-ETH raise,
///         §12.11, matching RobinFun's ~5.74 ETH / ~$44k bar; replaces the earlier flat 2.5-ETH /
///         G=2.484-ETH default and the retired $69k-mcap ~7.9166-ETH target), ETH/USD snapshot
///         $1770.30 (coingecko), $1.50 creation fee, 2.5%-of-G early cap, cost-based graduation
///         fee) so the gate-2 suites exercise the curve against the
///         SHIPPED launch economics without depending on `vm.readFile` / `fs_permissions`. Production
///         deploys read the JSON via `script/Deploy.s.sol` — values are NEVER inlined in `src/`
///         (spec §2, §6.4). Kept in one place so a re-run of the M0 notebook is a single-file diff
///         here. Still §13-pending (architect ratifies final values).
library TestConstants {
    // ── curve economics (constants.json.curve) — G = 5.749693 ETH flat target (§12.67, retargeted) ──
    uint256 internal constant VIRTUAL_ETH_0 = 2_030_818_236_177_600_249;
    uint256 internal constant VIRTUAL_TOKEN_0 = 1_073_226_583_912_778_964_568_548_738;
    uint256 internal constant CURVE_SUPPLY = 793_100_000_000_000_000_000_000_000;
    uint256 internal constant LP_TRANCHE = 206_900_000_000_000_000_000_000_000;
    uint256 internal constant GRADUATION_ETH = 5_749_693_301_560_943_464;

    // ── fees (constants.json.fees) ──
    uint16 internal constant TRADE_FEE_BPS = 100;
    /// @dev Creator-fee (curve-leg) default for the BASE fixture. MAINNET now ships 50 bps (§12.68;
    ///      `constants.json.fees.creatorFeeBps == 50`), but the base fixture keeps 0 so the legacy
    ///      treasury-only gate-2 core-curve suites (fee-exactness, solvency, k, graduation) stay a
    ///      clean creator-agnostic regression. The Phase-2 creator-LEG suites pass a non-zero override
    ///      ({factoryInit} 4-arg form, using `CREATOR_FEE_BPS_TESTNET`). Never inlined into curve
    ///      logic — the deploy reads `.fees.creatorFeeBps` from the constants file (spec §2/§6.4). NB:
    ///      §12.69's post-GRADUATION 50/50 LP-fee split is INDEPENDENT of this curve-leg bps and is
    ///      exercised for every graduation in the creator-aware {LPFeeVault} regardless of its value.
    uint16 internal constant CREATOR_FEE_BPS = 0;
    /// @dev The ratified §12.68 mainnet + testnet split (treasury 100 + creator 50 = 150 ≤ 200).
    ///      Used by the Phase-2 creator-fee test suites.
    uint16 internal constant CREATOR_FEE_BPS_TESTNET = 50;
    uint256 internal constant CREATION_FEE = 847_000_000_000_000;
    uint256 internal constant MAX_CREATION_FEE = 16_940_000_000_000_000;
    uint256 internal constant GRADUATION_FEE = 225_000_000_000_000;
    uint256 internal constant MAX_GRADUATION_FEE = 2_250_000_000_000_000;
    uint256 internal constant CALLER_REWARD = 2_824_000_000_000_000;
    uint256 internal constant MAX_CALLER_REWARD = 14_120_000_000_000_000;

    // ── anti-sniper (constants.json.antiSniper) ──
    uint64 internal constant EARLY_WINDOW_SECONDS = 8;
    uint128 internal constant MAX_EARLY_BUY_WEI = 143_742_000_000_000_000;

    // ── beta caps (constants.json.beta) ──
    uint128 internal constant PER_TOKEN_ETH_CAP = 8_624_539_952_341_415_196;
    uint128 internal constant GLOBAL_ETH_CAP = 287_484_665_078_047_173_200;

    // ── external (constants.json.external) ──
    address internal constant WETH = 0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73;

    // ── V3 graduation price + arb-back (constants.json.v3) — target tick ±174000 ──
    uint160 internal constant SQRT_PRICE_TOKEN0_X96 = 13_204_029_826_666_559_621_110_533;
    uint160 internal constant SQRT_PRICE_TOKEN1_X96 = 475_392_877_612_983_594_562_764_446_848_307;
    int24 internal constant TARGET_TICK_TOKEN0 = -174_000;
    int24 internal constant TARGET_TICK_TOKEN1 = 174_000;
    int24 internal constant TOLERANCE_TICKS = 100;
    uint8 internal constant MAX_ARB_ITERATIONS = 8;
    uint16 internal constant MIGRATION_SLIPPAGE_BPS = 100;

    /// @notice Build the factory init struct from the M0 fixture.
    function factoryInit(address treasury, address owner) internal pure returns (CurveFactory.FactoryInit memory) {
        return factoryInit(treasury, owner, WETH);
    }

    /// @notice Factory init with a WETH override — the gate-2 invariant-6 / migrator suites deploy a
    ///         local {MockWETH9} (the canonical address has no code locally) and must bind the whole
    ///         stack to it. Uses the default (mainnet-mirroring) `CREATOR_FEE_BPS == 0`.
    function factoryInit(address treasury, address owner, address weth_)
        internal
        pure
        returns (CurveFactory.FactoryInit memory)
    {
        return factoryInit(treasury, owner, weth_, CREATOR_FEE_BPS);
    }

    /// @notice Factory init with a WETH override AND a creator-fee-leg override (spec §12.63) — the
    ///         Phase-2 creator-fee suites pass a non-zero `creatorFeeBps_` (e.g. the testnet 50, or
    ///         the boundary 100 for the `== 200` cap edge). The additive ≤2% cap is enforced by the
    ///         factory constructor.
    function factoryInit(address treasury, address owner, address weth_, uint16 creatorFeeBps_)
        internal
        pure
        returns (CurveFactory.FactoryInit memory)
    {
        return CurveFactory.FactoryInit({
            weth: weth_,
            treasury: treasury,
            initialOwner: owner,
            virtualEth0: VIRTUAL_ETH_0,
            virtualToken0: VIRTUAL_TOKEN_0,
            curveSupply: CURVE_SUPPLY,
            lpTranche: LP_TRANCHE,
            graduationEth: GRADUATION_ETH,
            tradeFeeBps: TRADE_FEE_BPS,
            creatorFeeBps: creatorFeeBps_,
            creationFee: CREATION_FEE,
            maxCreationFee: MAX_CREATION_FEE,
            graduationFee: GRADUATION_FEE,
            maxGraduationFee: MAX_GRADUATION_FEE,
            callerReward: CALLER_REWARD,
            maxCallerReward: MAX_CALLER_REWARD,
            earlyWindowSeconds: EARLY_WINDOW_SECONDS,
            maxEarlyBuyWei: MAX_EARLY_BUY_WEI,
            perTokenEthCap: PER_TOKEN_ETH_CAP,
            globalEthCap: GLOBAL_ETH_CAP
        });
    }

    /// @notice Build the migrator init struct from the M0 fixture (constants.json.v3 + addresses).
    function migratorInit(address factory_, address v3Factory_, address npm_, address weth_, address vault_)
        internal
        pure
        returns (V3Migrator.MigratorInit memory)
    {
        return migratorInit(factory_, v3Factory_, npm_, weth_, vault_, MIGRATION_SLIPPAGE_BPS);
    }

    /// @notice Migrator init with a `migrationSlippageBps` override — used ONLY by the M-10-A
    ///         freeze-regression suite (M1-13 kill-test 5): `slippageBps = 0` makes
    ///         `tokenArbFloor == LP_TOKEN_TRANCHE`, byte-for-byte the PRE-FIX token-leg budget rule,
    ///         so reverting the symmetric floor demonstrably reproduces the §12.12 freeze.
    function migratorInit(
        address factory_,
        address v3Factory_,
        address npm_,
        address weth_,
        address vault_,
        uint16 migrationSlippageBps
    ) internal pure returns (V3Migrator.MigratorInit memory) {
        return V3Migrator.MigratorInit({
            factory: factory_,
            v3Factory: v3Factory_,
            positionManager: npm_,
            weth: weth_,
            vault: vault_,
            sqrtPriceToken0X96: SQRT_PRICE_TOKEN0_X96,
            sqrtPriceToken1X96: SQRT_PRICE_TOKEN1_X96,
            targetTickToken0: TARGET_TICK_TOKEN0,
            targetTickToken1: TARGET_TICK_TOKEN1,
            toleranceTicks: TOLERANCE_TICKS,
            maxArbIterations: MAX_ARB_ITERATIONS,
            migrationSlippageBps: migrationSlippageBps
        });
    }
}
