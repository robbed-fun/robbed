// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {CurveFactory} from "src/CurveFactory.sol";
import {V3Migrator} from "src/V3Migrator.sol";

/// @title TestConstants — M0 economics fixture for unit/fuzz/invariant tests
/// @notice TEST-ONLY. Mirrors `tools/m0/out/constants.json` (generatedAt 2026-07-10) so the gate-2
///         suites exercise the curve against the REAL launch economics without depending on
///         `vm.readFile` / `fs_permissions`. Production deploys read the JSON via
///         `script/Deploy.s.sol` — values are NEVER inlined in `src/` (spec §2, §6.4). Kept in one
///         place so a re-run of the M0 notebook is a single-file diff here.
library TestConstants {
    // ── curve economics (constants.json.curve) ──
    uint256 internal constant VIRTUAL_ETH_0 = 2_852_303_954_560_041_089;
    uint256 internal constant VIRTUAL_TOKEN_0 = 1_073_179_114_341_976_436_170_422_978;
    uint256 internal constant CURVE_SUPPLY = 793_100_000_000_000_000_000_000_000;
    uint256 internal constant LP_TRANCHE = 206_900_000_000_000_000_000_000_000;
    uint256 internal constant GRADUATION_ETH = 8_076_868_822_140_981_824;

    // ── fees (constants.json.fees) ──
    uint16 internal constant TRADE_FEE_BPS = 100;
    uint256 internal constant CREATION_FEE = 847_000_000_000_000;
    uint256 internal constant MAX_CREATION_FEE = 16_940_000_000_000_000;
    uint256 internal constant GRADUATION_FEE = 450_000_000_000_000;
    uint256 internal constant MAX_GRADUATION_FEE = 4_500_000_000_000_000;
    uint256 internal constant CALLER_REWARD = 2_822_000_000_000_000;
    uint256 internal constant MAX_CALLER_REWARD = 14_110_000_000_000_000;

    // ── anti-sniper (constants.json.antiSniper) ──
    uint64 internal constant EARLY_WINDOW_SECONDS = 8;
    uint128 internal constant MAX_EARLY_BUY_WEI = 201_922_000_000_000_000;

    // ── beta caps (constants.json.beta) ──
    uint128 internal constant PER_TOKEN_ETH_CAP = 12_115_303_233_211_472_736;
    uint128 internal constant GLOBAL_ETH_CAP = 403_843_441_107_049_091_200;

    // ── external (constants.json.external) ──
    address internal constant WETH = 0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73;

    // ── V3 graduation price + arb-back (constants.json.v3) ──
    uint160 internal constant SQRT_PRICE_TOKEN0_X96 = 15_650_667_588_154_918_705_036_412;
    uint160 internal constant SQRT_PRICE_TOKEN1_X96 = 401_075_653_803_896_166_612_957_246_818_246;
    int24 internal constant TARGET_TICK_TOKEN0 = -170_600;
    int24 internal constant TARGET_TICK_TOKEN1 = 170_600;
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
            migrationSlippageBps: MIGRATION_SLIPPAGE_BPS
        });
    }
}
