// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {CommonBase} from "forge-std/Base.sol";
import {StdCheats} from "forge-std/StdCheats.sol";
import {StdUtils} from "forge-std/StdUtils.sol";

import {CurveFactory} from "src/CurveFactory.sol";
import {BondingCurve} from "src/BondingCurve.sol";
import {LaunchToken} from "src/LaunchToken.sol";
import {V3Migrator} from "src/V3Migrator.sol";
import {LPFeeVault} from "src/LPFeeVault.sol";
import {ICurveFactory} from "src/interfaces/ICurveFactory.sol";
import {IUniswapV3Factory} from "src/interfaces/external/IUniswapV3Factory.sol";
import {INonfungiblePositionManager} from "src/interfaces/external/INonfungiblePositionManager.sol";

import {TestRouter} from "test/harness/Harness.sol";
import {TestConstants} from "test/harness/TestConstants.sol";
import {MockWETH9} from "test/mocks/MockWETH9.sol";
import {MockArbSys} from "test/mocks/MockArbSys.sol";

/// @title V3Fixture — deploys REAL Uniswap V3 core + periphery bytecode locally + the full ROBBED_
///        stack, for the gate-2 invariant-6 (pool-griefing) and migrator/vault unit suites
/// @notice The single 0.8.35 pin cannot compile v3-core (0.7.6), so this loads the PRECOMPILED
///         official artifacts (`test/vendor/uniswap/*.json`, unpkg v3-core 1.0.1 +
///         v3-periphery 1.4.4) via `vm.getCode` and deploys them with CREATE — the only way to
///         exercise the genuine `slot0`/`swap`/`mint` math under this workspace. The core factory's
///         constructor pre-enables the 1% tier (10000→200), and the periphery's baked-in
///         POOL_INIT_CODE_HASH matches this core, so `createAndInitializePoolIfNecessary`/`mint`
///         resolve pool addresses correctly. Gate-3 fork tests (M1-12) hit the real §12.28
///         deployment + real WETH instead.
/// @dev Inherits the forge-std base so both `Test`-based unit suites and the `CommonBase`-based
///      invariant handler can reuse the same deploy path.
abstract contract V3Fixture is CommonBase, StdCheats, StdUtils {
    address internal constant NPM_DESCRIPTOR = 0x000000000000000000000000000000000000bEEF; // token URI only

    CurveFactory internal factory;
    TestRouter internal router;
    V3Migrator internal migrator;
    LPFeeVault internal vault;
    MockWETH9 internal weth;
    IUniswapV3Factory internal v3Factory;
    INonfungiblePositionManager internal npm;

    /// @dev Deploy the whole stack. `treasury` + `owner` are supplied so a test can point `treasury`
    ///      at a reverting contract (the TM-T1 proof) or an EOA (wei-exact accounting).
    function _deployV3FullStack(address treasury, address owner) internal {
        _deployV3FullStack(treasury, owner, address(0), TestConstants.MIGRATION_SLIPPAGE_BPS);
    }

    /// @dev Full-stack deploy with two M1-13 kill-test hooks:
    ///      `wethAt` — if non-zero, the {MockWETH9} RUNTIME code is `vm.etch`ed at that address
    ///      instead of a fresh CREATE, FORCING the token/WETH sort order (`vm.etch` sets runtime
    ///      bytecode only — safe here because MockWETH9 has no constructor-initialised storage:
    ///      name/symbol/decimals are constants, balances start empty). Etching at
    ///      `type(uint160).max` makes every CREATE2 subject token sort as token0; etching at a tiny
    ///      address makes it token1 — the mirror ordering the arb-back mutation campaign showed the
    ///      suite never exercised (survivors 6/7/19/97/99/100).
    ///      `migrationSlippageBps` — per-leg arb budget knob; `0` reproduces the PRE-M-10-A token-leg
    ///      floor (`tokenArbFloor == LP_TOKEN_TRANCHE`) for the freeze-regression suite.
    function _deployV3FullStack(address treasury, address owner, address wethAt, uint16 migrationSlippageBps) internal {
        // ArbSys stand-in (anti-sniper is timestamp-based; parity-only here).
        vm.etch(address(0x64), address(new MockArbSys()).code);

        if (wethAt == address(0)) {
            weth = new MockWETH9();
        } else {
            vm.etch(wethAt, address(new MockWETH9()).code);
            weth = MockWETH9(payable(wethAt));
        }
        (v3Factory, npm) = _deployRealV3(address(weth));

        factory = new CurveFactory(TestConstants.factoryInit(treasury, owner, address(weth)));
        vault = new LPFeeVault(address(npm), treasury);
        migrator = new V3Migrator(
            TestConstants.migratorInit(
                address(factory), address(v3Factory), address(npm), address(weth), address(vault), migrationSlippageBps
            )
        );
        router = new TestRouter(ICurveFactory(address(factory)));

        vm.startPrank(owner);
        factory.setMigrator(address(migrator));
        factory.setRouter(address(router));
        vm.stopPrank();
    }

    /// @dev Deploy the official precompiled UniswapV3Factory + NonfungiblePositionManager.
    function _deployRealV3(address weth_) internal returns (IUniswapV3Factory f, INonfungiblePositionManager n) {
        address fAddr = _create(vm.getCode("test/vendor/uniswap/UniswapV3Factory.json"));
        bytes memory npmInit = abi.encodePacked(
            vm.getCode("test/vendor/uniswap/NonfungiblePositionManager.json"), abi.encode(fAddr, weth_, NPM_DESCRIPTOR)
        );
        address nAddr = _create(npmInit);
        f = IUniswapV3Factory(fAddr);
        n = INonfungiblePositionManager(nAddr);
    }

    /// @dev Raw CREATE from creation bytecode.
    function _create(bytes memory code) private returns (address addr) {
        assembly {
            addr := create(0, add(code, 0x20), mload(code))
        }
        require(addr != address(0), "V3Fixture: create failed");
    }

    /// @dev Create the subject token via the real launch path; returns token, curve, and the
    ///      pre-initialized V3 pool.
    function _createSubject(address creator) internal returns (LaunchToken token, BondingCurve curve, address pool) {
        uint256 creationFee = factory.creationFee();
        vm.deal(creator, creator.balance + creationFee);
        vm.prank(creator);
        (address t, address c,) =
            router.createToken{value: creationFee}("Subject", "SUBJ", keccak256("meta"), "ipfs://m", 0, block.timestamp);
        token = LaunchToken(t);
        curve = BondingCurve(payable(c));
        pool = v3Factory.getPool(t, address(weth), migrator.FEE_TIER());
    }
}
