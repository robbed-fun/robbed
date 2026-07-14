// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {CurveFactory} from "src/CurveFactory.sol";
import {BondingCurve} from "src/BondingCurve.sol";
import {LaunchToken} from "src/LaunchToken.sol";
import {Router} from "src/Router.sol";
import {ICurveFactory} from "src/interfaces/ICurveFactory.sol";

import {TestConstants} from "test/harness/TestConstants.sol";
import {MockMigrator, Reverter} from "test/harness/Harness.sol";
import {MockArbSys} from "test/mocks/MockArbSys.sol";

import {
    CreatesPaused,
    BuysPaused,
    UnknownToken,
    InvalidMsgValue,
    DeadlineExpired,
    ZeroAddress
} from "src/errors/Errors.sol";

/// @title Router unit suite (M1-9) — exercises the PRODUCTION {Router} (not the harness TestRouter)
/// @notice Proves the M1-9 obligations end-to-end: deadline + slippage on every trade path incl.
///         atomic create-buy, msg.sender forwarded as `trader`, and — decisively — the pause-matrix:
///         sells succeed with `pauseCreates=pauseBuys=true` AND with `treasury` pointed at a
/// reverting contract (/ threat-model UM-1), reinforcing "sells always
///         open" through the real Router.
contract RouterTest is Test {
    // EIP-2612 permit typehash (LaunchToken is ERC20Permit).
    bytes32 private constant PERMIT_TYPEHASH =
        keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)");

    CurveFactory internal factory;
    Router internal router;
    MockMigrator internal migrator;

    address internal treasury = makeAddr("treasury");
    address internal safeOwner = makeAddr("safeOwner");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");

    function setUp() public {
        // Mock ArbSys at address(100) so the real precompile path is stubbed in unit tests.
        vm.etch(address(0x64), address(new MockArbSys()).code);

        factory = new CurveFactory(TestConstants.factoryInit(treasury, safeOwner));
        migrator = new MockMigrator(ICurveFactory(address(factory)));
        router = new Router(ICurveFactory(address(factory)));

        vm.startPrank(safeOwner);
        factory.setMigrator(address(migrator));
        factory.setRouter(address(router));
        vm.stopPrank();
    }

    // ─────────────────────────────── Helpers ───────────────────────────────

    function _create() internal returns (LaunchToken token, BondingCurve curve) {
        uint256 fee = factory.creationFee();
        vm.deal(address(this), address(this).balance + fee);
        (address t, address c,) =
            router.createToken{value: fee}("Subject", "SUBJ", keccak256("meta"), "ipfs://meta", 0, block.timestamp);
        // Past the anti-sniper window so helper buys are uncapped.
        curve = BondingCurve(payable(c));
        vm.warp(uint256(curve.EARLY_WINDOW_END()));
        return (LaunchToken(t), curve);
    }

    function _buy(LaunchToken token, address actor, uint256 ethIn) internal returns (uint256 tokensOut) {
        vm.deal(actor, actor.balance + ethIn);
        vm.prank(actor);
        return router.buy{value: ethIn}(address(token), actor, 0, block.timestamp);
    }

    function _sell(LaunchToken token, address actor, uint256 amount, uint256 minEthOut)
        internal
        returns (uint256 ethOut)
    {
        vm.startPrank(actor);
        token.approve(address(router), amount);
        ethOut = router.sell(address(token), amount, actor, minEthOut, block.timestamp);
        vm.stopPrank();
    }

    receive() external payable {}

    // ─────────────────────────────── createToken ───────────────────────────────

    function test_createToken_noBuy_feeToTreasury() public {
        uint256 fee = factory.creationFee();
        vm.deal(address(this), fee);
        uint256 treBefore = treasury.balance;
        (address t, address c, uint256 tokensOut) =
            router.createToken{value: fee}("Name", "SYM", keccak256("m"), "uri", 0, block.timestamp);
        assertEq(tokensOut, 0, "no buy => zero tokensOut");
        assertEq(treasury.balance - treBefore, fee, "creation fee not forwarded to treasury");
        assertEq(factory.curveOf(t), c, "registry mismatch");
        assertEq(address(router).balance, 0, "router stranded ETH");
    }

    function test_createToken_atomicInitialBuy_forwardsTraderAndTokens() public {
        uint256 fee = factory.creationFee();
        uint256 buyIn = 0.05 ether; // below the new anti-sniper early cap (0.0621 ETH); create+buy is in-window
        vm.deal(alice, fee + buyIn);
        vm.prank(alice);
        (address t, address c, uint256 tokensOut) =
            router.createToken{value: fee + buyIn}("Name", "SYM", keccak256("m"), "uri", 1, block.timestamp);
        assertGt(tokensOut, 0, "initial buy produced no tokens");
        assertEq(IERC20(t).balanceOf(alice), tokensOut, "creator did not receive tokens");
        assertEq(treasury.balance, fee, "creation fee not forwarded");
        assertEq(address(router).balance, 0, "router stranded ETH");
        assertEq(c.code.length > 0 ? uint256(1) : uint256(0), 1, "curve not deployed");
    }

    function test_createToken_revertsCreatesPaused() public {
        vm.prank(safeOwner);
        factory.setPauseCreates(true);
        uint256 fee = factory.creationFee();
        vm.deal(address(this), fee);
        vm.expectRevert(CreatesPaused.selector);
        router.createToken{value: fee}("Name", "SYM", keccak256("m"), "uri", 0, block.timestamp);
    }

    function test_createToken_revertsDeadlineExpired() public {
        uint256 fee = factory.creationFee();
        vm.deal(address(this), fee);
        vm.warp(1000);
        vm.expectRevert(DeadlineExpired.selector);
        router.createToken{value: fee}("Name", "SYM", keccak256("m"), "uri", 0, 999);
    }

    function test_createToken_revertsInsufficientValue() public {
        uint256 fee = factory.creationFee();
        vm.deal(address(this), fee);
        vm.expectRevert(InvalidMsgValue.selector);
        router.createToken{value: fee - 1}("Name", "SYM", keccak256("m"), "uri", 0, block.timestamp);
    }

    function test_createToken_revertsMinTokensWithoutBuy() public {
        // slippage floor but no initial buy (msg.value == creationFee) is a caller error.
        uint256 fee = factory.creationFee();
        vm.deal(address(this), fee);
        vm.expectRevert(InvalidMsgValue.selector);
        router.createToken{value: fee}("Name", "SYM", keccak256("m"), "uri", 1, block.timestamp);
    }

    // ─────────────────────────────── buy ───────────────────────────────

    function test_buy_forwardsTokensAndCollectsNoRouterEth() public {
        (LaunchToken token,) = _create();
        uint256 got = _buy(token, alice, 0.2 ether);
        assertEq(token.balanceOf(alice), got, "recipient tokens mismatch");
        assertEq(address(router).balance, 0, "router stranded ETH");
    }

    function test_buy_revertsBuysPaused() public {
        (LaunchToken token,) = _create();
        vm.prank(safeOwner);
        factory.setPauseBuys(true);
        vm.deal(alice, 0.1 ether);
        vm.prank(alice);
        vm.expectRevert(BuysPaused.selector);
        router.buy{value: 0.1 ether}(address(token), alice, 0, block.timestamp);
    }

    function test_buy_revertsDeadline() public {
        (LaunchToken token,) = _create();
        vm.deal(alice, 0.1 ether);
        uint256 past = block.timestamp;
        vm.warp(block.timestamp + 10);
        vm.prank(alice);
        vm.expectRevert(DeadlineExpired.selector);
        router.buy{value: 0.1 ether}(address(token), alice, 0, past);
    }

    function test_buy_revertsUnknownToken() public {
        vm.deal(alice, 0.1 ether);
        vm.prank(alice);
        vm.expectRevert(UnknownToken.selector);
        router.buy{value: 0.1 ether}(address(0xBEEF), alice, 0, block.timestamp);
    }

    function test_buy_revertsZeroRecipient() public {
        (LaunchToken token,) = _create();
        vm.deal(alice, 0.1 ether);
        vm.prank(alice);
        vm.expectRevert(ZeroAddress.selector);
        router.buy{value: 0.1 ether}(address(token), address(0), 0, block.timestamp);
    }

    function test_buy_revertsSlippage() public {
        (LaunchToken token,) = _create();
        vm.deal(alice, 0.1 ether);
        vm.prank(alice);
        vm.expectRevert(); // SlippageExceeded(actual, min) from the curve
        router.buy{value: 0.1 ether}(address(token), alice, type(uint256).max, block.timestamp);
    }

    // ─────────────────────────────── sell ───────────────────────────────

    function test_sell_roundtripPaysSeller() public {
        (LaunchToken token,) = _create();
        uint256 got = _buy(token, alice, 0.3 ether);
        uint256 balBefore = alice.balance;
        uint256 ethOut = _sell(token, alice, got, 0);
        assertGt(ethOut, 0, "no ETH paid");
        assertEq(alice.balance - balBefore, ethOut, "seller net mismatch");
        assertEq(token.balanceOf(alice), 0, "tokens not fully sold");
        assertEq(address(router).balance, 0, "router stranded ETH");
    }

    function test_sell_revertsDeadline() public {
        (LaunchToken token,) = _create();
        uint256 got = _buy(token, alice, 0.2 ether);
        uint256 past = block.timestamp;
        vm.warp(block.timestamp + 10);
        vm.startPrank(alice);
        token.approve(address(router), got);
        vm.expectRevert(DeadlineExpired.selector);
        router.sell(address(token), got, alice, 0, past);
        vm.stopPrank();
    }

    function test_sell_revertsSlippage() public {
        (LaunchToken token,) = _create();
        uint256 got = _buy(token, alice, 0.2 ether);
        vm.startPrank(alice);
        token.approve(address(router), got);
        vm.expectRevert(); // SlippageExceeded
        router.sell(address(token), got, alice, type(uint256).max, block.timestamp);
        vm.stopPrank();
    }

    function test_sell_revertsUnknownToken() public {
        vm.prank(alice);
        vm.expectRevert(UnknownToken.selector);
        router.sell(address(0xBEEF), 1, alice, 0, block.timestamp);
    }

    // ─────────────────────────────── sellWithPermit ───────────────────────────────

    function test_sellWithPermit_signedApprovalSells() public {
        (LaunchToken token,) = _create();
        (address seller, uint256 pk) = makeAddrAndKey("permitSeller");
        uint256 got = _buy(token, seller, 0.2 ether);

        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _signPermit(token, seller, pk, address(router), got, deadline);

        uint256 balBefore = seller.balance;
        vm.prank(seller);
        uint256 ethOut = router.sellWithPermit(address(token), got, seller, 0, deadline, v, r, s);
        assertGt(ethOut, 0, "permit sell paid nothing");
        assertEq(seller.balance - balBefore, ethOut, "seller net mismatch");
        assertEq(token.balanceOf(seller), 0, "tokens not sold");
    }

    function test_sellWithPermit_revertsExpiredDeadline() public {
        // Deadline enforced INDEPENDENTLY of the permit (decision #2): an expired trade deadline
        // reverts even though the try/catch would otherwise swallow the permit's own expiry.
        (LaunchToken token,) = _create();
        (address seller, uint256 pk) = makeAddrAndKey("permitSeller2");
        uint256 got = _buy(token, seller, 0.2 ether);
        uint256 deadline = block.timestamp; // valid now
        (uint8 v, bytes32 r, bytes32 s) = _signPermit(token, seller, pk, address(router), got, deadline);

        vm.warp(block.timestamp + 1); // now past the deadline
        vm.prank(seller);
        vm.expectRevert(DeadlineExpired.selector);
        router.sellWithPermit(address(token), got, seller, 0, deadline, v, r, s);
    }

    function test_sellWithPermit_frontRunPermitTolerated() public {
        // Griefer submits the permit first; the Router's try/catch swallows the now-used permit and
        // proceeds on the already-set allowance.
        (LaunchToken token,) = _create();
        (address seller, uint256 pk) = makeAddrAndKey("permitSeller3");
        uint256 got = _buy(token, seller, 0.2 ether);
        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _signPermit(token, seller, pk, address(router), got, deadline);

        // Front-run: anyone submits the signed permit directly to the token.
        token.permit(seller, address(router), got, deadline, v, r, s);

        vm.prank(seller);
        uint256 ethOut = router.sellWithPermit(address(token), got, seller, 0, deadline, v, r, s);
        assertGt(ethOut, 0, "front-run permit should not brick the sell");
    }

    // ══════════════════════════ PAUSE MATRIX (/ UM-1) ══════════════════════════

    /// @notice Sells succeed with BOTH pause flags on — the sell path reads no pause flag anywhere.
    function test_pauseMatrix_sellsSucceed_whenCreatesAndBuysPaused() public {
        (LaunchToken token,) = _create();
        uint256 got = _buy(token, alice, 0.3 ether);

        // Owner slams every pause it has authority over.
        vm.startPrank(safeOwner);
        factory.setPauseCreates(true);
        factory.setPauseBuys(true);
        vm.stopPrank();

        // Buys and creates are now blocked...
        vm.deal(bob, 0.1 ether);
        vm.prank(bob);
        vm.expectRevert(BuysPaused.selector);
        router.buy{value: 0.1 ether}(address(token), bob, 0, block.timestamp);

        // ...but the sell goes through and pays the seller.
        uint256 balBefore = alice.balance;
        uint256 ethOut = _sell(token, alice, got, 0);
        assertGt(ethOut, 0, "SELL FROZEN while paused - spec 6.5 violated");
        assertEq(alice.balance - balBefore, ethOut, "seller not paid under pause");
    }

    /// @notice Sells succeed with `treasury` pointed at a contract that reverts on ETH receipt — no
    /// trade path calls the treasury. `sweepFees()` is the only casualty (retriable).
    function test_pauseMatrix_sellsSucceed_withRevertingTreasury() public {
        (LaunchToken token, BondingCurve curve) = _create();
        uint256 got = _buy(token, alice, 0.3 ether);

        // Point the treasury at a contract that reverts on every incoming ETH.
        Reverter rev = new Reverter();
        vm.prank(safeOwner);
        factory.setTreasury(address(rev));

        // The sell still pays the seller in full — the reverting treasury is never on the path.
        uint256 balBefore = alice.balance;
        uint256 ethOut = _sell(token, alice, got, 0);
        assertGt(ethOut, 0, "SELL FROZEN by hostile treasury - 12.25 violated");
        assertEq(alice.balance - balBefore, ethOut, "seller not paid with hostile treasury");

        // And the fees the trades accrued are still safely escrowed, merely un-sweepable for now.
        assertGt(curve.accruedFees(), 0, "fees should be escrowed, not lost");
        vm.expectRevert(); // EthTransferFailed — sweep is retriable, never a trade blocker
        curve.sweepFees();
    }

    // ─────────────────────────────── permit signing util ───────────────────────────────

    function _signPermit(LaunchToken token, address owner, uint256 pk, address spender, uint256 value, uint256 deadline)
        private
        view
        returns (uint8 v, bytes32 r, bytes32 s)
    {
        bytes32 structHash =
            keccak256(abi.encode(PERMIT_TYPEHASH, owner, spender, value, token.nonces(owner), deadline));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", token.DOMAIN_SEPARATOR(), structHash));
        (v, r, s) = vm.sign(pk, digest);
    }
}
