// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {Test} from "forge-std/Test.sol";
import {console2} from "forge-std/console2.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

import {CurveFactory} from "src/CurveFactory.sol";
import {BondingCurve} from "src/BondingCurve.sol";
import {LaunchToken} from "src/LaunchToken.sol";
import {Router} from "src/Router.sol";
import {V3Migrator} from "src/V3Migrator.sol";
import {LPFeeVault} from "src/LPFeeVault.sol";
import {ICurveFactory} from "src/interfaces/ICurveFactory.sol";
import {IBondingCurve} from "src/interfaces/IBondingCurve.sol";
import {IUniswapV3Factory} from "src/interfaces/external/IUniswapV3Factory.sol";
import {IUniswapV3Pool} from "src/interfaces/external/IUniswapV3Pool.sol";
import {INonfungiblePositionManager} from "src/interfaces/external/INonfungiblePositionManager.sol";
import {IWETH9} from "src/interfaces/external/IWETH9.sol";

import {TestConstants} from "test/harness/TestConstants.sol";
import {PoolGriefer} from "test/harness/PoolGriefer.sol";

/// @title Gate-6 economic red-team on the LIVE Robinhood Chain fork (spec §10 gate 6, §2.2)
/// @notice ADDED BY robbed-security. Read-only audit; TEST ADDITION ONLY — no production-code edit.
///         Live-chain confirmation of the deterministic gate-6 sims (`test/economic/*`): the same
///         adversary patterns against the REAL §12.28 Uniswap V3 Factory/NPM and REAL WETH
///         0x0Bd7..AD73, using the PRODUCTION Router/Migrator/Vault. Env-gated on ROBINHOOD_RPC_URL
///         (skips cleanly under the default profile). Run:
///         `FOUNDRY_PROFILE=fork ROBINHOOD_RPC_URL=https://rpc.mainnet.chain.robinhood.com forge test
///          --match-contract EconRedTeamFork -vv`
contract EconRedTeamFork is Test {
    address internal constant WETH = 0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73;
    uint256 internal constant CHAIN_ID = 4663;
    uint256 internal constant BPS = 10_000;
    /// @dev Latest 4663 height observed while authoring (2026-07-12). Override via ROBINHOOD_FORK_BLOCK
    ///      (0 = live latest). Pinned so the two tests share Foundry's RPC cache (rate-limit hygiene).
    uint256 internal constant DEFAULT_FORK_BLOCK = 7_964_424;

    bool internal forked;
    address internal v3FactoryAddr;
    address internal npmAddr;

    CurveFactory internal factory;
    Router internal router;
    V3Migrator internal migrator;
    LPFeeVault internal vault;

    address internal treasury = makeAddr("efTreasury");
    address internal owner = makeAddr("efOwner");
    address internal grad = makeAddr("efGrad");

    function setUp() public {
        string memory url = vm.envOr("ROBINHOOD_RPC_URL", string(""));
        if (bytes(url).length == 0) return;
        uint256 pin = vm.envOr("ROBINHOOD_FORK_BLOCK", DEFAULT_FORK_BLOCK);
        if (pin == 0) vm.createSelectFork(url);
        else vm.createSelectFork(url, pin);
        require(block.chainid == CHAIN_ID, "gate 6: ROBINHOOD_RPC_URL is not chain 4663");
        forked = true;

        string memory json = vm.readFile("../tools/m0/out/constants.json");
        v3FactoryAddr = vm.parseJsonAddress(json, ".external.v3Factory");
        npmAddr = vm.parseJsonAddress(json, ".external.positionManager");
        // Registry sanity (same asserts as the gate-3 lifecycle): fail closed on wrong 4663 addrs.
        assertEq(IUniswapV3Factory(v3FactoryAddr).feeAmountTickSpacing(10_000), 200, "live V3 1% tier spacing");
        assertEq(INonfungiblePositionManager(npmAddr).WETH9(), WETH, "live NPM.WETH9 != canonical");

        vault = new LPFeeVault(npmAddr, treasury);
        factory = new CurveFactory(TestConstants.factoryInit(treasury, owner));
        migrator =
            new V3Migrator(TestConstants.migratorInit(address(factory), v3FactoryAddr, npmAddr, WETH, address(vault)));
        router = new Router(ICurveFactory(address(factory)));
        vm.startPrank(owner);
        factory.setMigrator(address(migrator));
        factory.setRouter(address(router));
        vm.stopPrank();
    }

    // ─────────────────────────── helpers ───────────────────────────

    function _create(string memory tag)
        internal
        returns (LaunchToken token, BondingCurve curve, address pool, bool t0)
    {
        uint256 fee = factory.creationFee();
        address creator = makeAddr(tag);
        vm.deal(creator, fee);
        vm.prank(creator);
        (address tk, address cv,) =
            router.createToken{value: fee}(tag, "SUBJ", keccak256(bytes(tag)), "ipfs://m", 0, block.timestamp);
        token = LaunchToken(tk);
        curve = BondingCurve(payable(cv));
        pool = IUniswapV3Factory(v3FactoryAddr).getPool(tk, WETH, migrator.FEE_TIER());
        t0 = tk < WETH;
    }

    function _fillToReady(BondingCurve curve, LaunchToken token, address who) internal {
        vm.warp(uint256(curve.EARLY_WINDOW_END()) + 1);
        (,, uint256 realEth,) = curve.reserves();
        uint256 gross = Math.ceilDiv((curve.GRADUATION_ETH() - realEth) * BPS, BPS - curve.TRADE_FEE_BPS()) + 1e15;
        vm.deal(who, gross);
        vm.prank(who);
        router.buy{value: gross}(address(token), who, 0, block.timestamp);
        assertEq(uint8(curve.phase()), uint8(IBondingCurve.Phase.ReadyToGraduate), "fill != ReadyToGraduate");
    }

    function _targetTick(bool t0) internal view returns (int24) {
        return t0 ? migrator.TARGET_TICK_TOKEN0() : migrator.TARGET_TICK_TOKEN1();
    }

    function _targetSqrt(bool t0) internal view returns (uint160) {
        return t0 ? migrator.SQRT_PRICE_TOKEN0_X96() : migrator.SQRT_PRICE_TOKEN1_X96();
    }

    function _tickOf(address pool) internal view returns (int24 tk) {
        (, tk,,,,,) = IUniswapV3Pool(pool).slot0();
    }

    function _absDiff(int24 a, int24 b) internal pure returns (uint256) {
        return a >= b ? uint256(uint24(a - b)) : uint256(uint24(b - a));
    }

    function _tokenValueWei(uint256 amt) internal pure returns (uint256) {
        return (amt * (TestConstants.GRADUATION_ETH - TestConstants.GRADUATION_FEE)) / TestConstants.LP_TRANCHE;
    }

    // ═══════════════════ UM-2 Part-2 grief-lock cost on the LIVE chain ═══════════════════

    // Storage-threaded UM-2 scenario state (keeps the deep flow off the stack, non-viaIR pin).
    LaunchToken internal _t;
    BondingCurve internal _c;
    address internal _pool;
    bool internal _t0;
    PoolGriefer internal _atk;
    address internal _holder;
    uint256 internal _holderTokens;
    uint256 internal _atkValStart;
    uint256 internal _committed;

    function test_fork_UM2_griefLockCost() public {
        if (!forked) vm.skip(true);
        _fork_buildFrozen();
        _fork_correctAndGraduate();
    }

    function _fork_buildFrozen() internal {
        (_t, _c, _pool, _t0) = _create("um2fork");
        int24 tt = _targetTick(_t0);
        uint160 target = _targetSqrt(_t0);

        _holder = makeAddr("efHolder");
        vm.warp(uint256(_c.EARLY_WINDOW_END()) + 1);
        vm.deal(_holder, 1 ether);
        vm.prank(_holder);
        router.buy{value: 1 ether}(address(_t), _holder, 0, block.timestamp);
        _holderTokens = _t.balanceOf(_holder);

        _atk = new PoolGriefer(_pool, address(_t), WETH, npmAddr);
        vm.deal(address(_atk), 200 ether);
        vm.prank(address(_atk));
        IWETH9(WETH).deposit{value: 150 ether}();
        vm.deal(address(_atk), address(_atk).balance + 2 ether);
        vm.prank(address(_atk));
        router.buy{value: 2 ether}(address(_t), address(_atk), 0, block.timestamp);
        require(_t.balanceOf(address(_atk)) >= 4_500_000e18, "attacker under-funded");
        _atkValStart = _atkVal();

        if (_t0) _atk.grief_mint(tt + 400, tt + 2400, 4_500_000e18, 0);
        else _atk.grief_mint(tt - 2400, tt - 400, 0, 4_500_000e18);
        if (_t0) _atk.grief_swap(false, 60 ether, uint160((uint256(target) * 114) / 100));
        else _atk.grief_swap(true, 60 ether, uint160((uint256(target) * 88) / 100));
        assertGt(_absDiff(_tickOf(_pool), tt), uint256(uint24(migrator.TOLERANCE_TICKS())), "grief vacuous");

        _fillToReady(_c, _t, makeAddr("efFiller"));

        uint256 curveEthBefore = address(_c).balance;
        uint256 atkNativeBefore = address(_atk).balance;
        vm.prank(grad);
        try _c.graduate() {
            revert("live grief did not freeze graduation (deep band should ArbBudgetExceeded)");
        } catch {}
        assertEq(uint8(_c.phase()), uint8(IBondingCurve.Phase.ReadyToGraduate), "not retriable after freeze");
        assertGe(address(_c).balance, _c.GRADUATION_ETH(), "curve raise not retained");
        assertEq(address(_c).balance, curveEthBefore, "curve balance moved while frozen");
        assertEq(address(_atk).balance, atkNativeBefore, "attacker gained native ETH");

        _committed = _atkValStart - _atkVal();
        console2.log("=== FORK UM-2 grief-lock cost (live chain 4663) ===");
        console2.log("fork block                   :", block.number);
        console2.log("token0 ordering?             :", _t0);
        console2.log("committed to freeze (wei)    :", _committed);
        console2.log("GRADUATION_ETH (wei)         :", _c.GRADUATION_ETH());
        assertLt(_committed, 1 ether, "freeze cost far below curve value");
    }

    function _fork_correctAndGraduate() internal {
        int24 tt = _targetTick(_t0);
        uint160 target = _targetSqrt(_t0);
        PoolGriefer corr = new PoolGriefer(_pool, address(_t), WETH, npmAddr);
        vm.prank(_holder);
        _t.transfer(address(corr), _holderTokens);
        uint256 corrWethBefore = IERC20(WETH).balanceOf(address(corr));
        corr.grief_swap(_t0, int256(_holderTokens), target); // token->WETH pushes price to target
        int256 corrProfit = int256(IERC20(WETH).balanceOf(address(corr)) - corrWethBefore)
            - int256(_tokenValueWei(_holderTokens - _t.balanceOf(address(corr))));
        console2.log("corrector profit vs target   :");
        console2.logInt(corrProfit);

        int24 tol = migrator.TOLERANCE_TICKS();
        if (_tickOf(_pool) < tt - tol || _tickOf(_pool) > tt + tol) {
            corr.grief_swap(_t0, int256(_t.balanceOf(address(corr))), target);
        }
        vm.prank(grad);
        try _c.graduate() {
            assertEq(uint8(_c.phase()), uint8(IBondingCurve.Phase.Graduated), "post-correction graduate failed");
            console2.log("graduate() SUCCEEDED after correction (non-permanent) on the live chain");
        } catch {
            assertEq(uint8(_c.phase()), uint8(IBondingCurve.Phase.ReadyToGraduate), "must stay retriable");
            console2.log("still retriable post single-corrector (curve retains ETH)");
        }
        int256 atkNet = int256(_atkVal()) - int256(_atkValStart);
        console2.log("attacker net value change    :");
        console2.logInt(atkNet);
        assertLe(atkNet, int256(0), "attacker profited from grief on the live chain");
    }

    function _atkVal() internal view returns (uint256) {
        return IERC20(WETH).balanceOf(address(_atk)) + _tokenValueWei(_t.balanceOf(address(_atk)));
    }

    // ═══════════════════ Curve adversaries on the LIVE chain (production Router) ═══════════════════

    function test_fork_curveAdversaries() public {
        if (!forked) vm.skip(true);
        (LaunchToken token, BondingCurve curve,,) = _create("advfork");

        // Sniper: single actor sweeps to graduation via <=cap chunks inside the window.
        uint256 cap = uint256(curve.MAX_EARLY_BUY());
        address sniper = makeAddr("efSniper");
        uint256 chunks;
        while (curve.phase() == IBondingCurve.Phase.Trading && chunks < 100) {
            assertLt(block.timestamp, uint256(curve.EARLY_WINDOW_END()), "inside window");
            (,, uint256 realEth,) = curve.reserves();
            uint256 grossToFinish = Math.ceilDiv((curve.GRADUATION_ETH() - realEth) * BPS, BPS - curve.TRADE_FEE_BPS());
            uint256 g = grossToFinish < cap ? grossToFinish : cap;
            vm.deal(sniper, g);
            vm.prank(sniper);
            router.buy{value: g}(address(token), sniper, 0, block.timestamp);
            chunks++;
        }
        assertEq(uint8(curve.phase()), uint8(IBondingCurve.Phase.ReadyToGraduate), "sniper swept to graduation");
        assertGt(token.balanceOf(sniper), curve.CURVE_SUPPLY() * 99 / 100, "chunk-sniper took >99% supply");
        console2.log("=== FORK sniper: single-actor chunk bypass ===");
        console2.log("chunks (<=cap) to graduate   :", chunks);

        // Sandwich (fresh curve): worst-case ordering profit + victim-slippage floor.
        (LaunchToken tk2, BondingCurve cv2,,) = _create("advfork2");
        vm.warp(uint256(cv2.EARLY_WINDOW_END()));
        address seed = makeAddr("efSeed");
        vm.deal(seed, 2 ether);
        vm.prank(seed);
        router.buy{value: 2 ether}(address(tk2), seed, 0, block.timestamp);

        (uint256 fair,,,) = cv2.quoteBuy(0.3 ether);
        address atk2 = makeAddr("efSand");
        vm.deal(atk2, 10 ether);
        vm.prank(atk2);
        uint256 atkTok = router.buy{value: 0.5 ether}(address(tk2), atk2, 0, block.timestamp);
        address victim = makeAddr("efVictim");
        vm.deal(victim, 0.3 ether);
        vm.prank(victim);
        uint256 vFill = router.buy{value: 0.3 ether}(address(tk2), victim, 0, block.timestamp);
        vm.startPrank(atk2);
        tk2.approve(address(router), atkTok);
        uint256 back = router.sell(address(tk2), atkTok, atk2, 0, block.timestamp);
        vm.stopPrank();
        console2.log("=== FORK sandwich: worst-case ordering ===");
        console2.log("attacker net (wei, +=profit) :");
        console2.logInt(int256(back) - int256(0.5 ether));
        console2.log("naive victim token loss bps  :", (fair - vFill) * BPS / fair);

        // Wash: one 1-ETH round trip fee bleed on the curve.
        address washer = makeAddr("efWash");
        uint256 feesBefore = cv2.accruedFees();
        vm.deal(washer, 1 ether);
        vm.prank(washer);
        uint256 wgot = router.buy{value: 1 ether}(address(tk2), washer, 0, block.timestamp);
        vm.startPrank(washer);
        tk2.approve(address(router), wgot);
        uint256 wback = router.sell(address(tk2), wgot, washer, 0, block.timestamp);
        vm.stopPrank();
        console2.log("=== FORK wash: 1-ETH round-trip loss (wei) ===", uint256(1 ether) - wback);
        assertGt(cv2.accruedFees() - feesBefore, 0, "wash fed curve fees");
    }
}
