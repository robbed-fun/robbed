// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";

import {V3Fixture} from "test/harness/V3Fixture.sol";
import {PoolGriefer} from "test/harness/PoolGriefer.sol";
import {LaunchToken} from "src/LaunchToken.sol";
import {BondingCurve} from "src/BondingCurve.sol";
import {LPFeeVault} from "src/LPFeeVault.sol";
import {IBondingCurve} from "src/interfaces/IBondingCurve.sol";
import {IUniswapV3Pool} from "src/interfaces/external/IUniswapV3Pool.sol";
import {INonfungiblePositionManager} from "src/interfaces/external/INonfungiblePositionManager.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import {ZeroAddress, NotPositionManager} from "src/errors/Errors.sol";

/// @title LPFeeVault unit tests (M1-10; spec §6.3.4, §6.6, §12.69)
/// @notice Proves: LP NFT custody; `collect` splits accrued V3 fees 50/50 treasury/creator (creator
///         cut routed to the {CreatorVault}); the caller can never siphon; principal liquidity is
///         untouched by a collect; `onERC721Received` accepts NFTs only from the NPM; constructor
///         zero-checks. The §12.69 split invariants (exact-sum, principal-monotonic, un-brickable,
///         set-once) live in `test/unit/LPFeeVaultCreatorSplit.t.sol`; this suite keeps the base
///         custody/guard coverage.
contract LPFeeVaultTest is Test, V3Fixture {
    bytes32 internal constant GRADUATED_SIG =
        keccak256("Graduated(address,address,uint256,uint128,uint256,uint256,uint256,address,uint256,uint256,uint256)");

    address internal treasury = makeAddr("treasury");
    address internal owner = makeAddr("safeOwner");
    address internal buyer = makeAddr("buyer");

    function setUp() public {
        _deployV3FullStack(treasury, owner);
    }

    // ── constructor + guards ────────────────────────────────────────────────────

    function test_constructor_setsImmutables() public view {
        assertEq(address(vault.positionManager()), address(npm), "npm");
        assertEq(vault.treasury(), treasury, "treasury");
        assertEq(vault.factory(), address(factory), "factory");
        assertEq(vault.creatorLpShareBps(), 5000, "creator LP share must be 50pct (12.69)");
    }

    function test_constructor_zeroReverts() public {
        vm.expectRevert(ZeroAddress.selector);
        new LPFeeVault(address(0), treasury, address(factory));
        vm.expectRevert(ZeroAddress.selector);
        new LPFeeVault(address(npm), address(0), address(factory));
        vm.expectRevert(ZeroAddress.selector);
        new LPFeeVault(address(npm), treasury, address(0));
    }

    function test_onERC721Received_onlyFromNPM() public {
        vm.prank(makeAddr("randomSender"));
        vm.expectRevert(NotPositionManager.selector);
        vault.onERC721Received(address(0), address(0), 1, "");

        vm.prank(address(npm));
        assertEq(
            vault.onERC721Received(address(0), address(0), 1, ""),
            IERC721Receiver.onERC721Received.selector,
            "must accept from NPM"
        );
    }

    // ── full lifecycle: fees split 50/50 treasury/creator, principal locked (§12.69) ─────────────

    function test_collect_split50_50_principalUntouched() public {
        (LaunchToken token, BondingCurve curve, address pool, uint256 tokenId) = _graduate("v1");
        assertEq(vault.creatorOf(tokenId), curve.creator(), "creator not registered at graduation");
        assertEq(npm.ownerOf(tokenId), address(vault), "vault must own the LP NFT");
        (,,,,,,, uint128 liqBefore,,,,) = npm.positions(tokenId);
        assertGt(liqBefore, 0, "no principal");

        _accrueFees(token, pool);
        _assertSplit(token, tokenId, curve.creator());

        // Principal is untouched — the vault can only collect, never decrease liquidity.
        (,,,,,,, uint128 liqAfter,,,,) = npm.positions(tokenId);
        assertEq(liqAfter, liqBefore, "principal liquidity changed (must be permanently locked)");
    }

    /// @dev Round-trip a small trade through the graduated pool so fees accrue on both legs.
    function _accrueFees(LaunchToken token, address pool) internal {
        PoolGriefer trader = new PoolGriefer(pool, address(token), address(weth), address(npm));
        vm.deal(address(trader), 100 ether);
        vm.prank(address(trader));
        weth.deposit{value: 50 ether}();
        _tradeBothWays(trader, token, pool);
    }

    /// @dev Collect from an arbitrary caller and assert the exact 50/50 split on both legs + no residue.
    function _assertSplit(LaunchToken token, uint256 tokenId, address creator) internal {
        uint256 tTokenBefore = token.balanceOf(treasury);
        uint256 tWethBefore = weth.balanceOf(treasury);

        vm.prank(makeAddr("altruistCollector"));
        (uint256 a0, uint256 a1) = vault.collect(tokenId);
        assertTrue(a0 > 0 || a1 > 0, "no fees collected");

        (uint256 tokenAmt, uint256 wethAmt) = address(token) < address(weth) ? (a0, a1) : (a1, a0);
        uint256 tokenCreator = (tokenAmt * 5000) / 10_000;
        uint256 wethCreator = (wethAmt * 5000) / 10_000;

        // Treasury got its half (odd wei biased to treasury), exactly.
        assertEq(token.balanceOf(treasury) - tTokenBefore, tokenAmt - tokenCreator, "treasury token half");
        assertEq(weth.balanceOf(treasury) - tWethBefore, wethAmt - wethCreator, "treasury WETH half");
        // Creator's half is escrowed per (creator, token) in the CreatorVault.
        assertEq(creatorVault.tokenBalanceOf(creator, address(token)), tokenCreator, "creator token half");
        assertEq(creatorVault.tokenBalanceOf(creator, address(weth)), wethCreator, "creator WETH half");
        // Exact-sum, per leg: nothing stranded in the vault.
        assertEq(token.balanceOf(address(vault)), 0, "vault retained token dust");
        assertEq(weth.balanceOf(address(vault)), 0, "vault retained WETH dust");
    }

    function test_collect_recipientIsTreasury_notCaller() public {
        (LaunchToken token,, address pool, uint256 tokenId) = _graduate("v2");
        PoolGriefer trader = new PoolGriefer(pool, address(token), address(weth), address(npm));
        vm.deal(address(trader), 100 ether);
        vm.prank(address(trader));
        weth.deposit{value: 50 ether}();
        _tradeBothWays(trader, token, pool);

        address collector = makeAddr("greedyCollector");
        uint256 collectorTokenBefore = token.balanceOf(collector);
        uint256 collectorWethBefore = weth.balanceOf(collector);
        vm.prank(collector);
        vault.collect(tokenId);
        assertEq(token.balanceOf(collector), collectorTokenBefore, "caller siphoned token fees");
        assertEq(weth.balanceOf(collector), collectorWethBefore, "caller siphoned WETH fees");
    }

    // ── helpers ──────────────────────────────────────────────────────────────

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

    /// @dev Round-trip a small trade through the graduated pool to accrue fees on both tokens.
    function _tradeBothWays(PoolGriefer trader, LaunchToken token, address pool) internal {
        uint160 minSqrt = 4_295_128_739 + 1;
        uint160 maxSqrt = 1_461_446_703_485_210_103_287_273_052_203_988_822_378_723_970_342 - 1;
        // WETH → token, then token → WETH (fee taken on both legs).
        bool wethIsToken0 = address(weth) < address(token);
        trader.grief_swap(wethIsToken0, 1 ether, wethIsToken0 ? minSqrt : maxSqrt);
        uint256 tokBal = token.balanceOf(address(trader));
        if (tokBal > 0) trader.grief_swap(!wethIsToken0, int256(tokBal / 2), !wethIsToken0 ? minSqrt : maxSqrt);
    }
}
