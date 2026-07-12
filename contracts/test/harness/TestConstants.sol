// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {CurveFactory} from "src/CurveFactory.sol";
import {V3Migrator} from "src/V3Migrator.sol";

/// @title TestConstants — M0 economics fixture for unit/fuzz/invariant tests
/// @notice TEST-ONLY. Mirrors `tools/m0/out/constants.json` (generatedAt 2026-07-12 — the M1 real-gas
///         re-derivation: fork-measured graduate() gas + a fresh sourced ETH/USD snapshot $1817.62,
///         coingecko, replacing the 2026-07-10 $1771.51 snapshot; same reviewed derivation methodology
///         — $69k mcap target, $1.50 creation fee, 2.5%-of-G early cap, cost-based graduation fee) so
///         the gate-2 suites exercise the curve against the REAL launch economics without depending on
///         `vm.readFile` / `fs_permissions`. Production deploys read the JSON via `script/Deploy.s.sol`
///         — values are NEVER inlined in `src/` (spec §2, §6.4). Kept in one place so a re-run of the
///         M0 notebook is a single-file diff here. Still §13-pending (architect ratifies final values).
library TestConstants {
    // ── curve economics (constants.json.curve) ──
    uint256 internal constant VIRTUAL_ETH_0 = 2_795_549_696_042_257_634;
    uint256 internal constant VIRTUAL_TOKEN_0 = 1_073_163_119_713_500_705_850_232_259;
    uint256 internal constant CURVE_SUPPLY = 793_100_000_000_000_000_000_000_000;
    uint256 internal constant LP_TRANCHE = 206_900_000_000_000_000_000_000_000;
    uint256 internal constant GRADUATION_ETH = 7_916_609_892_081_533_890;

    // ── fees (constants.json.fees) ──
    uint16 internal constant TRADE_FEE_BPS = 100;
    uint256 internal constant CREATION_FEE = 825_000_000_000_000;
    uint256 internal constant MAX_CREATION_FEE = 16_500_000_000_000_000;
    uint256 internal constant GRADUATION_FEE = 122_085_000_000_000;
    uint256 internal constant MAX_GRADUATION_FEE = 1_220_850_000_000_000;
    uint256 internal constant CALLER_REWARD = 2_751_000_000_000_000;
    uint256 internal constant MAX_CALLER_REWARD = 13_755_000_000_000_000;

    // ── anti-sniper (constants.json.antiSniper) ──
    uint64 internal constant EARLY_WINDOW_SECONDS = 8;
    uint128 internal constant MAX_EARLY_BUY_WEI = 197_915_000_000_000_000;

    // ── beta caps (constants.json.beta) ──
    uint128 internal constant PER_TOKEN_ETH_CAP = 11_874_914_838_122_300_835;
    uint128 internal constant GLOBAL_ETH_CAP = 395_830_494_604_076_694_500;

    // ── external (constants.json.external) ──
    address internal constant WETH = 0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73;

    // ── V3 graduation price + arb-back (constants.json.v3) ──
    uint160 internal constant SQRT_PRICE_TOKEN0_X96 = 15_494_948_590_672_169_390_171_897;
    uint160 internal constant SQRT_PRICE_TOKEN1_X96 = 405_106_328_598_304_867_947_102_422_407_779;
    int24 internal constant TARGET_TICK_TOKEN0 = -170_800;
    int24 internal constant TARGET_TICK_TOKEN1 = 170_800;
    int24 internal constant TOLERANCE_TICKS = 100;
    uint8 internal constant MAX_ARB_ITERATIONS = 8;
    uint16 internal constant MIGRATION_SLIPPAGE_BPS = 100;

    /// @notice Build the factory init struct from the M0 fixture.
    function factoryInit(address treasury, address owner) internal pure returns (CurveFactory.FactoryInit memory) {
        return factoryInit(treasury, owner, WETH);
    }

    /// @notice Factory init with a WETH override — the gate-2 invariant-6 / migrator suites deploy a
    ///         local {MockWETH9} (the canonical address has no code locally) and must bind the whole
    ///         stack to it.
    function factoryInit(address treasury, address owner, address weth_)
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
