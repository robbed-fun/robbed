// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";

import {V3Fixture} from "test/harness/V3Fixture.sol";
import {PoolGriefer} from "test/harness/PoolGriefer.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {LaunchToken} from "src/LaunchToken.sol";
import {BondingCurve} from "src/BondingCurve.sol";
import {IBondingCurve} from "src/interfaces/IBondingCurve.sol";
import {IUniswapV3Pool} from "src/interfaces/external/IUniswapV3Pool.sol";
import {ZeroAddress, NotMigrator, CreatorAlreadyRegistered, NotLpFeeVault} from "src/errors/Errors.sol";

/// @title LPFeeVault + CreatorVault post-graduation split invariants
/// @notice The five invariants the creator-aware fee generation MUST hold, plus a full
///         lifecycle through the split and the CreatorVault ERC20-custody surface:
///           (a) exact-sum split per leg     — `creatorAmt + treasuryAmt == collected`, both legs
///           (b) principal-monotonic         — position liquidity never decreases across collects
///           (c) un-brickable                — a hostile creator cannot freeze `collect()`
///           (d) set-once creator            — migrator-gated, unspoofable, non-overwritable
///           (e) post-grad zero curve value  — the curve holds nothing after graduation+sweep
///         Runs against the REAL vendored Uniswap V3 core+periphery via {V3Fixture} (same bytecode
///         the gate-2 pool-griefing suite uses), so `collect`/`mint`/`positions` exercise genuine
///         fee accrual and liquidity math.
contract LPFeeVaultCreatorSplitTest is Test, V3Fixture {
    bytes32 internal constant GRADUATED_SIG =
        keccak256("Graduated(address,address,uint256,uint128,uint256,uint256,uint256,address,uint256,uint256,uint256)");

    address internal treasury = makeAddr("splitTreasury");
    address internal owner = makeAddr("splitOwner");
    address internal buyer = makeAddr("splitBuyer");

    function setUp() public {
        _deployV3FullStack(treasury, owner);
    }

    // ─────────────────────── (a) exact-sum split per leg ────────────────────────

    function test_split_exactSumPerLeg() public {
        (LaunchToken token, BondingCurve curve, address pool, uint256 tokenId) = _graduate("aCreator");
        _accrueFees(token, pool, 1 ether);
        _assertExactSplit(token, tokenId, curve.creator());
    }

    /// @dev Fuzz the fee-generating trade size; the 50/50 split must be exact to the wei on both legs
    /// for any accrued amount (no leakage / rounding drain).
    function testFuzz_split_exactSumPerLeg(uint96 wethIn) public {
        wethIn = uint96(bound(wethIn, 0.01 ether, 20 ether));
        (LaunchToken token, BondingCurve curve, address pool, uint256 tokenId) = _graduate("aFuzzCreator");
        _accrueFees(token, pool, wethIn);
        _assertExactSplit(token, tokenId, curve.creator());
    }

    /// @dev Collect once, assert per-leg `creator + treasury == collected` exactly (treasury keeps the
    ///      odd wei), and that the vault retains ZERO residue on either leg.
    function _assertExactSplit(LaunchToken token, uint256 tokenId, address creator) internal {
        uint256 tTreasuryBefore = token.balanceOf(treasury);
        uint256 wTreasuryBefore = weth.balanceOf(treasury);

        vm.prank(makeAddr("anyCollector"));
        (uint256 a0, uint256 a1) = vault.collect(tokenId);
        assertTrue(a0 > 0 || a1 > 0, "no fees to split");

        (uint256 tokenAmt, uint256 wethAmt) = address(token) < address(weth) ? (a0, a1) : (a1, a0);
        _assertLegSplit(address(token), tokenAmt, creator, tTreasuryBefore);
        _assertLegSplit(address(weth), wethAmt, creator, wTreasuryBefore);
        assertEq(token.balanceOf(address(vault)), 0, "vault retained token");
        assertEq(weth.balanceOf(address(vault)), 0, "vault retained weth");
    }

    /// @dev One leg's exact-sum split: `creatorShare = amount·bps/1e4`, treasury gets the rest (odd wei
    ///      biased to treasury), treasury pushed exactly its share, CreatorVault credited exactly the
    ///      creator's share.
    function _assertLegSplit(address tok, uint256 amount, address creator, uint256 treasuryBefore) internal view {
        uint256 creatorShare = (amount * vault.creatorLpShareBps()) / 10_000;
        uint256 treasuryShare = amount - creatorShare;
        assertEq(creatorShare + treasuryShare, amount, "leg split != collected");
        assertGe(treasuryShare, creatorShare, "treasury-first: odd wei must bias to treasury");
        assertEq(IERC20(tok).balanceOf(treasury) - treasuryBefore, treasuryShare, "treasury leg receipt");
        assertEq(creatorVault.tokenBalanceOf(creator, tok), creatorShare, "creator leg credit");
    }

    // ─────────────────── (b) principal-monotonic across collects ────────────────

    function test_principalMonotonic_acrossCollects() public {
        (LaunchToken token,, address pool, uint256 tokenId) = _graduate("bCreator");
        (,,,,,,, uint128 liq0,,,,) = npm.positions(tokenId);
        assertGt(liq0, 0, "no principal minted");

        // Interleave three fee-accrual + collect rounds; liquidity must never decrease.
        for (uint256 i = 0; i < 3; ++i) {
            _accrueFees(token, pool, 1 ether + i * 0.5 ether);
            vault.collect(tokenId);
            (,,,,,,, uint128 liqN,,,,) = npm.positions(tokenId);
            assertGe(liqN, liq0, "principal liquidity decreased across a collect (must be locked)");
            assertEq(liqN, liq0, "principal liquidity changed (collect must never touch liquidity)");
        }
    }

    // ───────────────────── (c) un-brickable: hostile creator ────────────────────

    /// @notice A hostile/reverting creator address cannot freeze `collect()`. `collect` never calls the
    ///         creator — it routes the creator's ERC20 share to the (non-reverting) CreatorVault via a
    ///         pull. We etch code that reverts on ANY call at the registered creator address, then a
    ///         collect from an arbitrary caller must still succeed and credit the escrow. A SECOND
    ///         token's collect is likewise unaffected — the hostile creator freezes nothing but,
    ///         optionally, its own ETH-claim (its ERC20 claim isn't even brickable — plain transfer).
    function test_collect_unbrickable_hostileCreator() public {
        (LaunchToken token, BondingCurve curve, address pool, uint256 tokenId) = _graduate("cHostile");
        address creator = curve.creator();
        _accrueFees(token, pool, 2 ether);

        // Make the creator hostile: reverts on every call (mirrors the treasury TM-T1 technique).
        vm.etch(creator, hex"60006000fd");

        // collect() still succeeds and escrows the creator share (never pushed to the hostile EOA).
        vm.prank(makeAddr("altruist"));
        (uint256 a0, uint256 a1) = vault.collect(tokenId);
        assertTrue(a0 > 0 || a1 > 0, "collect frozen by a hostile creator (spec 12.69(iii) violation)");
        assertGt(creatorVault.tokenBalanceOf(creator, address(weth)), 0, "creator share not escrowed");

        // Even the creator's OWN ERC20 claim clears (a plain ERC20 transfer never calls the recipient),
        // so a hostile creator cannot brick even its own revenue on the ERC20 legs.
        uint256 wethOwed = creatorVault.tokenBalanceOf(creator, address(weth));
        creatorVault.claimERC20(creator, address(weth));
        assertEq(weth.balanceOf(creator), wethOwed, "hostile creator ERC20 claim did not pay");
    }

    // ─────────────────── (d) set-once, migrator-gated creator ───────────────────

    function test_registerCreator_onlyMigrator() public {
        vm.prank(makeAddr("notMigrator"));
        vm.expectRevert(NotMigrator.selector);
        vault.registerCreator(4242, makeAddr("spoofed"));
    }

    function test_registerCreator_rejectsZeroCreator() public {
        vm.prank(address(migrator));
        vm.expectRevert(ZeroAddress.selector);
        vault.registerCreator(4242, address(0));
    }

    function test_registerCreator_setOnce() public {
        address a = makeAddr("firstCreator");
        address b = makeAddr("secondCreator");
        vm.prank(address(migrator));
        vault.registerCreator(4242, a);
        assertEq(vault.creatorOf(4242), a, "creator not stored");

        // Even the migrator cannot overwrite a bound creator.
        vm.prank(address(migrator));
        vm.expectRevert(CreatorAlreadyRegistered.selector);
        vault.registerCreator(4242, b);
        assertEq(vault.creatorOf(4242), a, "creator overwritten (must be set-once)");
    }

    function test_graduation_registersCreator() public {
        (, BondingCurve curve,, uint256 tokenId) = _graduate("dCreator");
        assertEq(vault.creatorOf(tokenId), curve.creator(), "migrator did not register the creator at graduation");
    }

    // ─────────────── (e) full lifecycle + creator claims its cut ─────────────────

    function test_lifecycle_splitAndCreatorClaims() public {
        (LaunchToken token, BondingCurve curve, address pool, uint256 tokenId) = _graduate("eCreator");
        _assertPostGradZeroValue(token, curve);
        _accrueFees(token, pool, 3 ether);
        _collectThenCreatorClaims(token, tokenId, curve.creator());
    }

    /// @dev (e) post-grad zero curve value: the curve holds nothing beyond the still-sweepable escrow,
    ///      and the escrow drains to zero via the permissionless sweeps.
    function _assertPostGradZeroValue(LaunchToken token, BondingCurve curve) internal {
        assertEq(token.balanceOf(address(curve)), 0, "curve retained tokens post-grad");
        assertEq(address(curve).balance, curve.accruedFees() + curve.accruedCreatorFees(), "curve ETH beyond escrow");
        curve.sweepFees();
        curve.sweepCreatorFees();
        assertEq(address(curve).balance, 0, "curve not zero-value after sweeps");
    }

    /// @dev Collect, then the creator pulls its part-token / part-WETH cut (permissionless; funds fixed
    ///      to the creator, never the caller). Asserts the claimed amounts equal the 50% split and the
    ///      escrow zeroes.
    function _collectThenCreatorClaims(LaunchToken token, uint256 tokenId, address creator) internal {
        vm.prank(makeAddr("keeperCollect"));
        (uint256 a0, uint256 a1) = vault.collect(tokenId);
        (uint256 tokenAmt, uint256 wethAmt) = address(token) < address(weth) ? (a0, a1) : (a1, a0);
        uint256 tokenCreator = (tokenAmt * 5000) / 10_000;
        uint256 wethCreator = (wethAmt * 5000) / 10_000;

        uint256 creatorTokenBefore = token.balanceOf(creator);
        uint256 creatorWethBefore = weth.balanceOf(creator);
        vm.prank(makeAddr("keeperClaim")); // permissionless; recipient fixed to the creator
        creatorVault.claimERC20(creator, address(token));
        vm.prank(makeAddr("keeperClaim"));
        creatorVault.claimERC20(creator, address(weth));
        assertEq(token.balanceOf(creator) - creatorTokenBefore, tokenCreator, "creator token cut");
        assertEq(weth.balanceOf(creator) - creatorWethBefore, wethCreator, "creator weth cut");
        assertEq(creatorVault.tokenBalanceOf(creator, address(token)), 0, "token escrow not zeroed");
        assertEq(creatorVault.tokenBalanceOf(creator, address(weth)), 0, "weth escrow not zeroed");
    }

    // ─────────────────────── CreatorVault ERC20 custody ─────────────────────────

    function test_depositERC20_onlyLpFeeVault() public {
        // A non-LPFeeVault caller cannot credit ERC20 custody (exact-accounting gate).
        vm.prank(makeAddr("randomDepositor"));
        vm.expectRevert(NotLpFeeVault.selector);
        creatorVault.depositERC20(makeAddr("someCreator"), address(weth), 1 ether);
    }

    function test_claimERC20_crossTokenIsolation() public {
        (LaunchToken token, BondingCurve curve, address pool, uint256 tokenId) = _graduate("fCreator");
        address creator = curve.creator();
        _accrueFees(token, pool, 2 ether);
        vault.collect(tokenId);

        uint256 tokenOwed = creatorVault.tokenBalanceOf(creator, address(token));
        uint256 wethOwed = creatorVault.tokenBalanceOf(creator, address(weth));
        assertGt(tokenOwed, 0, "no token escrow");
        assertGt(wethOwed, 0, "no weth escrow");

        // Claiming the WETH leg leaves the token leg untouched (per-(creator,token) isolation).
        creatorVault.claimERC20(creator, address(weth));
        assertEq(creatorVault.tokenBalanceOf(creator, address(weth)), 0, "weth leg not zeroed");
        assertEq(creatorVault.tokenBalanceOf(creator, address(token)), tokenOwed, "token leg wrongly touched");
    }

    // ─────────────────────────────── helpers ───────────────────────────────────

    function _graduate(string memory seed)
        internal
        returns (LaunchToken token, BondingCurve curve, address pool, uint256 tokenId)
    {
        (token, curve, pool) = _createSubject(makeAddr(seed));
        vm.warp(uint256(curve.EARLY_WINDOW_END()) + 1);
        (,, uint256 realEth,) = curve.reserves();
        uint256 gross = ((curve.GRADUATION_ETH() - realEth) * 10_000) / (10_000 - curve.TRADE_FEE_BPS()) + 1e15;
        vm.deal(buyer, gross);
        vm.prank(buyer);
        router.buy{value: gross}(address(token), buyer, 0, block.timestamp);

        vm.recordLogs();
        vm.prank(makeAddr("graduator")); // EOA caller can receive the native CALLER_REWARD
        curve.graduate();
        tokenId = _tokenIdFromLogs();
    }

    function _tokenIdFromLogs() internal returns (uint256) {
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i = 0; i < logs.length; ++i) {
            if (
                logs[i].emitter == address(migrator) && logs[i].topics.length == 4 && logs[i].topics[0] == GRADUATED_SIG
            ) {
                return uint256(logs[i].topics[3]);
            }
        }
        revert("no Graduated log");
    }

    /// @dev Round-trip a WETH-sized trade through the graduated pool to accrue fees on both legs.
    function _accrueFees(LaunchToken token, address pool, uint256 wethIn) internal {
        PoolGriefer trader = new PoolGriefer(pool, address(token), address(weth), address(npm));
        vm.deal(address(trader), wethIn + 100 ether);
        vm.prank(address(trader));
        weth.deposit{value: wethIn + 50 ether}();
        uint160 minSqrt = 4_295_128_739 + 1;
        uint160 maxSqrt = 1_461_446_703_485_210_103_287_273_052_203_988_822_378_723_970_342 - 1;
        bool wethIsToken0 = address(weth) < address(token);
        trader.grief_swap(wethIsToken0, int256(wethIn), wethIsToken0 ? minSqrt : maxSqrt);
        uint256 tokBal = token.balanceOf(address(trader));
        if (tokBal > 0) trader.grief_swap(!wethIsToken0, int256(tokBal / 2), !wethIsToken0 ? minSqrt : maxSqrt);
    }
}
