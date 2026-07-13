// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {BaseFixture} from "test/harness/BaseFixture.sol";
import {BondingCurve} from "src/BondingCurve.sol";
import {LaunchToken} from "src/LaunchToken.sol";
import {IRouter} from "src/interfaces/IRouter.sol";
import {IBondingCurve} from "src/interfaces/IBondingCurve.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @dev Malicious actor whose ETH-receive callback re-enters a permissionless curve entrypoint
///      (graduate / sweepFees). Mode selects the re-entry target.
contract ReentrantActor {
    enum Mode {
        Graduate,
        Sweep
    }

    IRouter internal router;
    IBondingCurve internal curve;
    address internal token;
    Mode internal mode;
    bool internal armed;

    constructor(IRouter router_, IBondingCurve curve_, address token_, Mode mode_) {
        router = router_;
        curve = curve_;
        token = token_;
        mode = mode_;
    }

    /// @notice Buy that will be graduation-clamped, producing a refund → re-entry mid-buy.
    function armedBuy() external payable {
        armed = true;
        router.buy{value: msg.value}(token, address(this), 0, block.timestamp);
    }

    /// @notice Sell whose proceeds payout triggers the re-entry.
    function armedSell(uint256 amount) external {
        armed = true;
        IERC20(token).approve(address(router), amount);
        router.sell(token, amount, address(this), 0, block.timestamp);
    }

    function buyTokens() external payable {
        router.buy{value: msg.value}(token, address(this), 0, block.timestamp);
    }

    receive() external payable {
        if (!armed) return;
        armed = false;
        // Re-enter a nonReentrant, permissionless entrypoint mid-trade. The shared guard must trip.
        if (mode == Mode.Graduate) {
            curve.graduate();
        } else {
            curve.sweepFees();
        }
    }
}

/// @title BondingCurve reentrancy suite (finding T-3) — cross-entrypoint guard + CEI
/// @notice Proves a refund/payout callback that re-enters `graduate()` or `sweepFees()` mid-trade is
///         blocked by the shared OZ `ReentrancyGuard`, so the attacker's own trade reverts and NO
///         shared state is poisoned (an honest trade immediately after still succeeds).
contract BondingCurveReentrancyTest is BaseFixture {
    LaunchToken internal token;
    BondingCurve internal curve;

    function setUp() public {
        _deployStack();
        (token, curve) = _create();
        vm.warp(uint256(curve.EARLY_WINDOW_END())); // past the anti-sniper window
    }

    /// @notice Buy-refund callback re-entering graduate() mid-buy: a 100-ETH buy clamps to the
    ///         graduation threshold and refunds the excess; the refund callback re-enters graduate()
    ///         and the guard reverts the whole buy.
    function test_refundCallback_reenteringGraduate_reverts() public {
        ReentrantActor attacker = new ReentrantActor(
            IRouter(address(router)), IBondingCurve(address(curve)), address(token), ReentrantActor.Mode.Graduate
        );
        vm.deal(address(attacker), 100 ether);
        vm.expectRevert(); // ReentrancyGuardReentrantCall bubbles up as EthTransferFailed on the refund
        attacker.armedBuy{value: 100 ether}();

        // No shared state poisoned: an honest buy + sell still works afterwards.
        _buy(curve, token, alice, 1 ether, 0);
        uint256 out = _sell(curve, token, alice, token.balanceOf(alice), 0);
        assertGt(out, 0, "honest trade broke after a reentrancy attempt");
    }

    /// @notice Sell-payout callback re-entering sweepFees() mid-sell: guard reverts the sell; the
    ///         attacker only fails its own trade.
    function test_sellCallback_reenteringSweep_reverts() public {
        ReentrantActor attacker = new ReentrantActor(
            IRouter(address(router)), IBondingCurve(address(curve)), address(token), ReentrantActor.Mode.Sweep
        );
        vm.deal(address(attacker), 2 ether);
        attacker.buyTokens{value: 0.5 ether}(); // acquire sellable tokens; leaves headroom under G=2.484
        uint256 bal = token.balanceOf(address(attacker));

        vm.expectRevert(); // reentrant sweepFees() trips the guard → sell reverts
        attacker.armedSell(bal);

        // Honest actor unaffected.
        _buy(curve, token, alice, 1 ether, 0);
        assertGt(_sell(curve, token, alice, token.balanceOf(alice), 0), 0, "honest sell broke");
    }

    /// @notice Sell-payout callback re-entering graduate() mid-sell also trips the guard.
    function test_sellCallback_reenteringGraduate_reverts() public {
        ReentrantActor attacker = new ReentrantActor(
            IRouter(address(router)), IBondingCurve(address(curve)), address(token), ReentrantActor.Mode.Graduate
        );
        vm.deal(address(attacker), 2 ether);
        attacker.buyTokens{value: 2 ether}();
        uint256 bal = token.balanceOf(address(attacker));

        vm.expectRevert();
        attacker.armedSell(bal);
    }
}
