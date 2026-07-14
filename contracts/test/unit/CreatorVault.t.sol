// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {Test} from "forge-std/Test.sol";
import {CreatorVault} from "src/CreatorVault.sol";
import {ICreatorVault} from "src/interfaces/ICreatorVault.sol";
import {Reverter} from "test/harness/Harness.sol";
import {MockWETH9} from "test/mocks/MockWETH9.sol";
import {ZeroAddress, NotCurve, NotLpFeeVault, EthTransferFailed} from "src/errors/Errors.sol";

/// @dev Minimal stand-in for the CurveFactory registry surfaces the vault reads: `isCurve` (gates the
/// ETH `deposit`) and `lpFeeVault` (gates `depositERC20`). Lets these unit tests exercise
///      the vault in isolation (the full stack is covered by CreatorFee.t.sol / CreatorFeeInvariants /
///      LPFeeVaultCreatorSplit).
contract MockCurveRegistry {
    mapping(address => bool) public isCurve;
    address public lpFeeVault;

    function register(address curve) external {
        isCurve[curve] = true;
    }

    function setLpFeeVault(address v) external {
        lpFeeVault = v;
    }
}

/// @title CreatorVault unit tests
/// @notice Proves the pull-payment escrow's minimalism + safety properties: deposit is curve-only and
///         cannot revert for a real curve; claim pays the fixed `creator` (never the caller) under
///         CEI + nonReentrant; a hostile/reverting creator's claim reverts in ISOLATION and leaves
///         the balance intact (retriable), never affecting anyone else's balance.
contract CreatorVaultTest is Test {
    MockCurveRegistry internal registry;
    CreatorVault internal vault;

    address internal curveA = makeAddr("curveA");
    address internal curveB = makeAddr("curveB");
    address internal creator1 = makeAddr("creator1");
    address internal creator2 = makeAddr("creator2");
    address internal keeper = makeAddr("keeper");

    function setUp() public {
        registry = new MockCurveRegistry();
        registry.register(curveA);
        registry.register(curveB);
        vault = new CreatorVault(address(registry));
        vm.deal(curveA, 100 ether);
        vm.deal(curveB, 100 ether);
    }

    function test_constructor_rejectsZeroFactory() public {
        vm.expectRevert(ZeroAddress.selector);
        new CreatorVault(address(0));
    }

    function test_deposit_creditsCreator_curveOnly() public {
        vm.expectEmit(true, true, true, true, address(vault));
        emit ICreatorVault.CreatorFeeDeposited(creator1, curveA, 1 ether);
        vm.prank(curveA);
        vault.deposit{value: 1 ether}(creator1);
        assertEq(vault.balanceOf(creator1), 1 ether, "creator1 not credited");
        assertEq(address(vault).balance, 1 ether, "vault did not custody the ETH");
    }

    function test_deposit_accumulatesAcrossCurves() public {
        vm.prank(curveA);
        vault.deposit{value: 1 ether}(creator1);
        vm.prank(curveB);
        vault.deposit{value: 2 ether}(creator1);
        assertEq(vault.balanceOf(creator1), 3 ether, "cross-curve accrual for one creator must sum");
    }

    function test_deposit_revertsForNonCurve() public {
        vm.deal(address(this), 1 ether);
        vm.expectRevert(NotCurve.selector);
        vault.deposit{value: 1 ether}(creator1);
    }

    function test_deposit_revertsForZeroCreator() public {
        vm.prank(curveA);
        vm.expectRevert(ZeroAddress.selector);
        vault.deposit{value: 1 ether}(address(0));
    }

    function test_claim_paysCreator_notCaller_permissionless() public {
        vm.prank(curveA);
        vault.deposit{value: 3 ether}(creator1);

        uint256 creatorBefore = creator1.balance;
        uint256 keeperBefore = keeper.balance;
        // A THIRD party triggers the claim; the money goes to the creator, never the caller.
        vm.prank(keeper);
        uint256 paid = vault.claim(creator1);
        assertEq(paid, 3 ether, "claim returned wrong amount");
        assertEq(creator1.balance - creatorBefore, 3 ether, "creator not paid its balance");
        assertEq(keeper.balance, keeperBefore, "caller must not receive the fees");
        assertEq(vault.balanceOf(creator1), 0, "balance not zeroed after claim");
    }

    function test_claim_zeroBalance_isNoOp() public {
        uint256 paid = vault.claim(creator1);
        assertEq(paid, 0, "claim of empty balance should pay 0");
    }

    /// @notice A hostile/reverting creator's claim reverts in ISOLATION: its own balance stays put
    ///         (retriable), and — crucially — no OTHER creator's balance or the vault's custody of
    /// their funds is affected. This is the vault-side of the no-freeze guarantee.
    function test_claim_hostileCreator_revertsButIsolated() public {
        Reverter hostile = new Reverter();
        vm.prank(curveA);
        vault.deposit{value: 5 ether}(address(hostile));
        vm.prank(curveB);
        vault.deposit{value: 4 ether}(creator2);

        // The hostile creator's claim reverts (its receive() rejects ETH) — but is retriable.
        vm.expectRevert(EthTransferFailed.selector);
        vault.claim(address(hostile));
        assertEq(vault.balanceOf(address(hostile)), 5 ether, "hostile balance must survive a failed claim");

        // An unrelated creator can still claim in full — the hostile creator froze nothing but itself.
        uint256 before = creator2.balance;
        vault.claim(creator2);
        assertEq(creator2.balance - before, 4 ether, "unrelated creator claim blocked by a hostile peer");
    }

    function test_noReceiveOrFallback_rejectsStrayEth() public {
        // The vault has no receive()/fallback(): every wei must enter via deposit(creator). A bare
        // send is rejected, so there is never unattributed ETH.
        (bool ok,) = address(vault).call{value: 1 ether}("");
        assertFalse(ok, "vault must reject unattributed ETH (no receive/fallback)");
    }

    // ─────────────────── ERC20 custody legs (post-graduation split) ───────────────────

    address internal feeVault = makeAddr("lpFeeVault");
    MockWETH9 internal erc20;

    /// @dev Wire the mock LPFeeVault + fund it with an ERC20 approved to the CreatorVault, so it can
    ///      `depositERC20` exactly as the real {LPFeeVault.collect} split routing does.
    function _setUpErc20() internal {
        registry.setLpFeeVault(feeVault);
        erc20 = new MockWETH9();
        vm.deal(feeVault, 100 ether);
        vm.startPrank(feeVault);
        erc20.deposit{value: 100 ether}();
        erc20.approve(address(vault), type(uint256).max);
        vm.stopPrank();
    }

    function test_depositERC20_creditsCreator_lpFeeVaultOnly() public {
        _setUpErc20();
        vm.expectEmit(true, true, true, true, address(vault));
        emit ICreatorVault.CreatorTokenDeposited(creator1, address(erc20), feeVault, 3 ether);
        vm.prank(feeVault);
        vault.depositERC20(creator1, address(erc20), 3 ether);
        assertEq(vault.tokenBalanceOf(creator1, address(erc20)), 3 ether, "creator1 token balance");
        assertEq(erc20.balanceOf(address(vault)), 3 ether, "vault did not custody the ERC20");
    }

    function test_depositERC20_revertsForNonLpFeeVault() public {
        _setUpErc20();
        vm.prank(makeAddr("notTheVault"));
        vm.expectRevert(NotLpFeeVault.selector);
        vault.depositERC20(creator1, address(erc20), 1 ether);
    }

    function test_depositERC20_revertsForZeroCreator() public {
        _setUpErc20();
        vm.prank(feeVault);
        vm.expectRevert(ZeroAddress.selector);
        vault.depositERC20(address(0), address(erc20), 1 ether);
    }

    function test_claimERC20_paysCreator_notCaller_permissionless() public {
        _setUpErc20();
        vm.prank(feeVault);
        vault.depositERC20(creator1, address(erc20), 5 ether);

        uint256 creatorBefore = erc20.balanceOf(creator1);
        vm.prank(keeper); // a third party triggers the claim; funds go only to the creator
        uint256 paid = vault.claimERC20(creator1, address(erc20));
        assertEq(paid, 5 ether, "claim returned wrong amount");
        assertEq(erc20.balanceOf(creator1) - creatorBefore, 5 ether, "creator not paid its token balance");
        assertEq(erc20.balanceOf(keeper), 0, "caller must not receive the fees");
        assertEq(vault.tokenBalanceOf(creator1, address(erc20)), 0, "balance not zeroed after claim");
    }

    function test_claimERC20_zeroBalance_isNoOp() public {
        _setUpErc20();
        uint256 paid = vault.claimERC20(creator1, address(erc20));
        assertEq(paid, 0, "empty claim should pay 0");
    }

    function test_depositERC20_accumulatesPerCreatorToken() public {
        _setUpErc20();
        vm.startPrank(feeVault);
        vault.depositERC20(creator1, address(erc20), 1 ether);
        vault.depositERC20(creator1, address(erc20), 2 ether);
        vm.stopPrank();
        assertEq(vault.tokenBalanceOf(creator1, address(erc20)), 3 ether, "per-(creator,token) accrual must sum");
        // A different creator's balance is isolated.
        assertEq(vault.tokenBalanceOf(creator2, address(erc20)), 0, "cross-creator leakage");
    }
}
