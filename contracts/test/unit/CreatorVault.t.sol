// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {Test} from "forge-std/Test.sol";
import {CreatorVault} from "src/CreatorVault.sol";
import {ICreatorVault} from "src/interfaces/ICreatorVault.sol";
import {Reverter} from "test/harness/Harness.sol";
import {ZeroAddress, NotCurve, EthTransferFailed} from "src/errors/Errors.sol";

/// @dev Minimal stand-in for the CurveFactory's `isCurve` registry — the ONLY factory surface the
///      vault reads. Lets these unit tests exercise the vault in isolation (the full stack is
///      covered by CreatorFee.t.sol / CreatorFeeInvariants).
contract MockCurveRegistry {
    mapping(address => bool) public isCurve;

    function register(address curve) external {
        isCurve[curve] = true;
    }
}

/// @title CreatorVault unit tests (spec §7, §12.63)
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
    ///         their funds is affected. This is the vault-side of the §12.63 no-freeze guarantee.
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
}
