// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {Test} from "forge-std/Test.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

import {CurveFactory} from "src/CurveFactory.sol";
import {BondingCurve} from "src/BondingCurve.sol";
import {LaunchToken} from "src/LaunchToken.sol";
import {ICurveFactory} from "src/interfaces/ICurveFactory.sol";
import {IBondingCurve} from "src/interfaces/IBondingCurve.sol";

import {TestRouter, MockMigrator} from "test/harness/Harness.sol";
import {TestConstants} from "test/harness/TestConstants.sol";
import {MockArbSys} from "test/mocks/MockArbSys.sol";

/// @title BaseFixture — shared deploy + trade helpers for the M1-7/M1-8 unit suites
/// @notice Wires CurveFactory + MockMigrator (sink) + TestRouter exactly as the invariant handler
///         does, and exposes `_create`/`_buy`/`_sell` helpers. Mirrors the M0 economics via
/// {TestConstants} (no inlined market metrics).
abstract contract BaseFixture is Test {
    CurveFactory internal factory;
    TestRouter internal router;
    MockMigrator internal migrator;

    address internal treasury = makeAddr("treasury");
    address internal safeOwner = makeAddr("safeOwner");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");

    function _deployStack() internal {
        vm.etch(address(0x64), address(new MockArbSys()).code);
        factory = new CurveFactory(TestConstants.factoryInit(treasury, safeOwner));
        migrator = new MockMigrator(ICurveFactory(address(factory)));
        router = new TestRouter(ICurveFactory(address(factory)));
        vm.startPrank(safeOwner);
        factory.setMigrator(address(migrator));
        factory.setRouter(address(router));
        vm.stopPrank();
    }

    function _create() internal returns (LaunchToken token, BondingCurve curve) {
        return _createWithBuy(0, 0);
    }

    function _createWithBuy(uint256 initialBuy, uint256 minTokensOut)
        internal
        returns (LaunchToken token, BondingCurve curve)
    {
        uint256 fee = factory.creationFee();
        vm.deal(address(this), address(this).balance + fee + initialBuy);
        (address t, address c,) = router.createToken{value: fee + initialBuy}(
            "Subject", "SUBJ", keccak256("meta-json"), "ipfs://meta", minTokensOut, block.timestamp
        );
        return (LaunchToken(t), BondingCurve(payable(c)));
    }

    function _buy(BondingCurve curve, LaunchToken token, address actor, uint256 ethIn, uint256 minTokensOut)
        internal
        returns (uint256 tokensOut)
    {
        vm.deal(actor, actor.balance + ethIn);
        vm.prank(actor);
        return router.buy{value: ethIn}(address(token), actor, minTokensOut, block.timestamp);
    }

    function _sell(BondingCurve curve, LaunchToken token, address actor, uint256 amount, uint256 minEthOut)
        internal
        returns (uint256 ethOut)
    {
        vm.startPrank(actor);
        token.approve(address(router), amount);
        ethOut = router.sell(address(token), amount, actor, minEthOut, block.timestamp);
        vm.stopPrank();
    }

    /// @dev Gross ETH needed to land net reserves exactly on GRADUATION_ETH from the current state.
    function _grossToGraduate(BondingCurve curve) internal view returns (uint256) {
        (,, uint256 realEth,) = curve.reserves();
        uint256 remaining = curve.GRADUATION_ETH() - realEth;
        return Math.ceilDiv(remaining * 10_000, 10_000 - curve.TRADE_FEE_BPS());
    }

    /// @dev Push a fresh curve to ReadyToGraduate (past the anti-sniper window + a lifted per-tx cap).
    function _fillToReady(BondingCurve curve, LaunchToken token, address actor) internal {
        vm.warp(uint256(curve.EARLY_WINDOW_END()));
        _buy(curve, token, actor, _grossToGraduate(curve), 0);
    }

    // Accept the CALLER_REWARD / refunds when this contract calls graduate()/buy() directly.
    receive() external payable {}
}
