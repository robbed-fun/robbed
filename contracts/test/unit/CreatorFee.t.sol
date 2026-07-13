// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {Test} from "forge-std/Test.sol";

import {CurveFactory} from "src/CurveFactory.sol";
import {BondingCurve} from "src/BondingCurve.sol";
import {LaunchToken} from "src/LaunchToken.sol";
import {CreatorVault} from "src/CreatorVault.sol";
import {ICurveFactory} from "src/interfaces/ICurveFactory.sol";
import {IBondingCurve} from "src/interfaces/IBondingCurve.sol";

import {TestRouter, MockMigrator, Reverter} from "test/harness/Harness.sol";
import {TestConstants} from "test/harness/TestConstants.sol";
import {MockArbSys} from "test/mocks/MockArbSys.sol";
import {FeeAboveCap, CreatorVaultUnset, AlreadyInitialized, ZeroAddress} from "src/errors/Errors.sol";

/// @title CreatorFee — full-stack Phase-2 creator-fee unit suite (spec §7, §12.63)
/// @notice Exercises the additive two-leg fee split, the ADDITIVE ≤2% cap (`== 200` accepted, `> 200`
///         reverts, constructor + both setters), the hostile-creator no-freeze guarantee, the
///         pull-payment sweep→vault→claim flow, graduation with a live creator escrow, and
///         backward-compat at `creatorFeeBps == 0`.
contract CreatorFeeTest is Test {
    uint256 internal constant BPS = 10_000;
    uint16 internal constant TREASURY_BPS = 100; // TestConstants.TRADE_FEE_BPS
    uint16 internal constant CREATOR_BPS = 50; // ratified §12.63 testnet placeholder
    /// @dev `_realEthReserves` storage slot (forge inspect BondingCurve storageLayout) — used to pin
    ///      the F-1 boundary `remaining` for the regression cases below.
    uint256 internal constant REAL_ETH_SLOT = 2;

    CurveFactory internal factory;
    TestRouter internal router;
    MockMigrator internal migrator;
    CreatorVault internal vault;

    address internal treasury = makeAddr("treasury");
    address internal safeOwner = makeAddr("safeOwner");
    address internal creator = makeAddr("creator");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");

    LaunchToken internal token;
    BondingCurve internal curve;

    // Accept the CALLER_REWARD when this contract calls graduate() directly.
    receive() external payable {}

    // ─────────────────────────────── fixtures ──────────────────────────────────

    function _deployStack(uint16 creatorFeeBps) internal {
        vm.etch(address(0x64), address(new MockArbSys()).code);
        factory = new CurveFactory(TestConstants.factoryInit(treasury, safeOwner, TestConstants.WETH, creatorFeeBps));
        migrator = new MockMigrator(ICurveFactory(address(factory)));
        router = new TestRouter(ICurveFactory(address(factory)));
        vault = new CreatorVault(address(factory));
        vm.startPrank(safeOwner);
        factory.setMigrator(address(migrator));
        factory.setRouter(address(router));
        factory.setCreatorVault(address(vault));
        vm.stopPrank();
    }

    function _createBy(address creator_) internal returns (LaunchToken t, BondingCurve c) {
        uint256 fee = factory.creationFee();
        vm.deal(creator_, creator_.balance + fee);
        vm.prank(creator_);
        (address tk, address cv,) =
            router.createToken{value: fee}("Subject", "SUBJ", keccak256("meta"), "ipfs://m", 0, block.timestamp);
        return (LaunchToken(tk), BondingCurve(payable(cv)));
    }

    function _buy(address actor, uint256 ethIn) internal returns (uint256 tokensOut) {
        vm.deal(actor, actor.balance + ethIn);
        vm.prank(actor);
        return router.buy{value: ethIn}(address(token), actor, 0, block.timestamp);
    }

    function _sell(address actor, uint256 amount) internal returns (uint256 ethOut) {
        vm.startPrank(actor);
        token.approve(address(router), amount);
        ethOut = router.sell(address(token), amount, actor, 0, block.timestamp);
        vm.stopPrank();
    }

    // ───────────────────────── ADDITIVE ≤2% cap (gate case) ─────────────────────

    function test_cap_boundaryEquals200_accepted() public {
        // treasury 100 + creator 100 == 200 (the boundary the architect flagged as a GATE-2 edge).
        _deployStack(100);
        assertEq(factory.tradeFeeBps() + factory.creatorFeeBps(), 200, "boundary sum must be exactly 200");
    }

    function test_cap_over200_reverts_atConstruction() public {
        vm.etch(address(0x64), address(new MockArbSys()).code);
        // treasury 100 + creator 101 == 201 > 200 → fail closed.
        vm.expectRevert(FeeAboveCap.selector);
        new CurveFactory(TestConstants.factoryInit(treasury, safeOwner, TestConstants.WETH, 101));
    }

    function test_cap_setCreatorFeeBps_enforced() public {
        _deployStack(0);
        vm.startPrank(safeOwner);
        factory.setCreatorFeeBps(100); // 100 + 100 == 200 OK
        assertEq(factory.creatorFeeBps(), 100, "setter did not apply at the boundary");
        vm.expectRevert(FeeAboveCap.selector);
        factory.setCreatorFeeBps(101); // 100 + 101 == 201 > 200
        vm.stopPrank();
    }

    function test_cap_setTradeFeeBps_enforcedWithCreatorLeg() public {
        _deployStack(100); // creator leg already 100
        vm.startPrank(safeOwner);
        factory.setTradeFeeBps(50); // 50 + 100 == 150 < 200 → SUCCEEDS (kills the `!= cap` mutant)
        assertEq(factory.tradeFeeBps(), 50, "sub-cap setTradeFeeBps must apply, not revert");
        factory.setTradeFeeBps(100); // 100 + 100 == 200 (boundary) OK
        vm.expectRevert(FeeAboveCap.selector);
        factory.setTradeFeeBps(101); // 101 + 100 == 201 > 200
        vm.stopPrank();
    }

    function test_setCreatorFeeBps_onlyOwner() public {
        _deployStack(0);
        vm.expectRevert();
        vm.prank(alice);
        factory.setCreatorFeeBps(50);
    }

    // ───────────────────────── vault wiring (fail-closed) ───────────────────────

    function test_setCreatorVault_oneTime() public {
        _deployStack(0); // already sets the vault once
        vm.startPrank(safeOwner);
        vm.expectRevert(AlreadyInitialized.selector);
        factory.setCreatorVault(address(0xBEEF));
        vm.stopPrank();
    }

    function test_setCreatorVault_rejectsZero() public {
        vm.etch(address(0x64), address(new MockArbSys()).code);
        CurveFactory f = new CurveFactory(TestConstants.factoryInit(treasury, safeOwner, TestConstants.WETH, 0));
        vm.prank(safeOwner);
        vm.expectRevert(ZeroAddress.selector);
        f.setCreatorVault(address(0));
    }

    function test_createToken_reverts_ifCreatorFeeSetButVaultUnset() public {
        // Factory with a live creator leg but NO wired vault → creates must fail closed (else creator
        // fees would sweep to the zero address and burn).
        vm.etch(address(0x64), address(new MockArbSys()).code);
        CurveFactory f =
            new CurveFactory(TestConstants.factoryInit(treasury, safeOwner, TestConstants.WETH, CREATOR_BPS));
        MockMigrator m = new MockMigrator(ICurveFactory(address(f)));
        TestRouter r = new TestRouter(ICurveFactory(address(f)));
        vm.startPrank(safeOwner);
        f.setMigrator(address(m));
        f.setRouter(address(r));
        vm.stopPrank();

        uint256 fee = f.creationFee();
        vm.deal(creator, fee);
        vm.prank(creator);
        vm.expectRevert(CreatorVaultUnset.selector);
        r.createToken{value: fee}("X", "X", keccak256("m"), "ipfs://m", 0, block.timestamp);
    }

    function test_createToken_atZeroCreatorFee_needsNoVault() public {
        // Backward-compat: a treasury-only factory (creatorFeeBps == 0) creates fine with NO vault.
        vm.etch(address(0x64), address(new MockArbSys()).code);
        CurveFactory f = new CurveFactory(TestConstants.factoryInit(treasury, safeOwner, TestConstants.WETH, 0));
        MockMigrator m = new MockMigrator(ICurveFactory(address(f)));
        TestRouter r = new TestRouter(ICurveFactory(address(f)));
        vm.startPrank(safeOwner);
        f.setMigrator(address(m));
        f.setRouter(address(r));
        vm.stopPrank();
        assertEq(f.creatorVault(), address(0), "no vault wired");

        uint256 fee = f.creationFee();
        vm.deal(creator, fee);
        vm.prank(creator);
        (, address cv,) = r.createToken{value: fee}("X", "X", keccak256("m"), "ipfs://m", 0, block.timestamp);
        assertEq(BondingCurve(payable(cv)).CREATOR_FEE_BPS(), 0, "creator leg must be 0");
    }

    // ─────────────────────────── two-leg fee split ──────────────────────────────

    function test_buy_splitsBothLegs_exact() public {
        _deployStack(CREATOR_BPS);
        (token, curve) = _createBy(creator);
        vm.warp(uint256(curve.EARLY_WINDOW_END())); // past anti-sniper so a 1 ETH buy is allowed

        uint256 gross = 1 ether;
        uint256 tBefore = curve.accruedFees();
        uint256 cBefore = curve.accruedCreatorFees();
        uint256 got = _buy(alice, gross);

        assertGt(got, 0, "buy returned no tokens");
        assertEq(curve.accruedFees() - tBefore, (gross * TREASURY_BPS) / BPS, "treasury leg wrong");
        assertEq(curve.accruedCreatorFees() - cBefore, (gross * CREATOR_BPS) / BPS, "creator leg wrong");
        // net that entered reserves = gross - both legs.
        (,, uint256 realEth,) = curve.reserves();
        assertEq(realEth, gross - (gross * TREASURY_BPS) / BPS - (gross * CREATOR_BPS) / BPS, "net into reserves wrong");
    }

    function test_sell_splitsBothLegs_exact() public {
        _deployStack(CREATOR_BPS);
        (token, curve) = _createBy(creator);
        vm.warp(uint256(curve.EARLY_WINDOW_END()));
        _buy(alice, 1 ether);

        uint256 amount = token.balanceOf(alice);
        (uint256 quotedNet, uint256 quotedTreasury) = curve.quoteSell(amount);
        uint256 cBefore = curve.accruedCreatorFees();
        uint256 aliceBefore = alice.balance;
        uint256 ethOut = _sell(alice, amount);

        assertEq(ethOut, quotedNet, "seller net != quote");
        uint256 creatorLeg = curve.accruedCreatorFees() - cBefore;
        // Reconstruct the gross from conserved parts and re-derive both legs by definition.
        uint256 gross = ethOut + quotedTreasury + creatorLeg;
        assertEq(quotedTreasury, (gross * TREASURY_BPS) / BPS, "treasury leg != bps of gross");
        assertEq(creatorLeg, (gross * CREATOR_BPS) / BPS, "creator leg != bps of gross");
        assertEq(alice.balance - aliceBefore, ethOut, "seller not paid net");
    }

    function test_zeroCreatorFee_isByteIdentical_noAccrual() public {
        _deployStack(0);
        (token, curve) = _createBy(creator);
        vm.warp(uint256(curve.EARLY_WINDOW_END()));
        _buy(alice, 1 ether);
        _sell(alice, token.balanceOf(alice) / 2);
        assertEq(curve.accruedCreatorFees(), 0, "no creator fee may accrue at creatorFeeBps == 0");
        // Treasury leg unchanged: exactly 1% of the buy gross accrued (no creator leg siphon).
        assertEq(curve.accruedFees() > 0, true, "treasury leg still accrues");
    }

    // ─────────────────────── hostile creator: no freeze ─────────────────────────

    /// @notice THE §12.63 proof (mirror of the TM-T1 hostile-treasury test): a reverting creator can
    ///         never freeze a buy or a sell. Fees accrue in-contract on the trade path (no creator or
    ///         vault call), so trading is unaffected; only the downstream claim reverts.
    function test_sellAndBuy_succeed_underHostileCreator() public {
        _deployStack(CREATOR_BPS);
        Reverter hostile = new Reverter();
        (token, curve) = _createBy(address(hostile));
        assertEq(curve.creator(), address(hostile), "creator not the hostile Reverter");

        vm.warp(uint256(curve.EARLY_WINDOW_END()));
        // A BUY clears against a hostile creator.
        uint256 got = _buy(alice, 0.5 ether);
        assertGt(got, 0, "buy blocked by hostile creator");
        assertGt(curve.accruedCreatorFees(), 0, "creator leg did not accrue");

        // A SELL clears too — the whole point.
        uint256 amount = token.balanceOf(alice);
        uint256 before = alice.balance;
        uint256 ethOut = _sell(alice, amount);
        assertGt(ethOut, 0, "SELL FROZEN by hostile creator (spec 6.5/12.63 violation)");
        assertEq(alice.balance - before, ethOut, "seller not paid under hostile creator");
    }

    function test_sweepCreatorFees_alwaysClears_evenHostile() public {
        _deployStack(CREATOR_BPS);
        Reverter hostile = new Reverter();
        (token, curve) = _createBy(address(hostile));
        vm.warp(uint256(curve.EARLY_WINDOW_END()));
        _buy(alice, 0.5 ether);

        uint256 escrow = curve.accruedCreatorFees();
        assertGt(escrow, 0, "no creator fees to sweep");
        // The sweep pushes to the vault (a non-reverting accumulate) — it ALWAYS succeeds, clearing
        // the curve escrow, even though the creator itself reverts on receive.
        uint256 swept = curve.sweepCreatorFees();
        assertEq(swept, escrow, "sweep amount != escrow");
        assertEq(curve.accruedCreatorFees(), 0, "escrow not cleared by sweep");
        assertEq(vault.balanceOf(address(hostile)), escrow, "vault not credited the hostile creator");

        // The creator's own claim reverts (isolated, retriable) — the fees are NOT lost, they wait.
        vm.expectRevert();
        vault.claim(address(hostile));
        assertEq(vault.balanceOf(address(hostile)), escrow, "claim revert must leave the balance intact");
    }

    // ─────────────────────── sweep → vault → claim (happy) ──────────────────────

    function test_sweepThenClaim_paysCreator() public {
        _deployStack(CREATOR_BPS);
        (token, curve) = _createBy(creator);
        vm.warp(uint256(curve.EARLY_WINDOW_END()));
        _buy(alice, 0.5 ether);
        _sell(alice, token.balanceOf(alice) / 2);

        uint256 escrow = curve.accruedCreatorFees();
        assertGt(escrow, 0, "no creator fees accrued");
        curve.sweepCreatorFees();
        assertEq(vault.balanceOf(creator), escrow, "vault not credited");

        uint256 before = creator.balance;
        uint256 paid = vault.claim(creator);
        assertEq(paid, escrow, "claim paid wrong amount");
        assertEq(creator.balance - before, escrow, "creator not paid");
        assertEq(vault.balanceOf(creator), 0, "vault balance not zeroed");
    }

    // ─────────────── F-1 regression: two-floor clamp underflow boundary ─────────

    /// @dev Pin the curve's `remaining` (= GRADUATION_ETH − realEth) to an exact value by writing
    ///      `_realEthReserves` and backing it with real ETH, so the F-1 boundary inputs are hit
    ///      precisely (they require a specific residue random buys never reach).
    function _forceRemaining(uint256 remaining) internal {
        uint256 target = curve.GRADUATION_ETH() - remaining;
        vm.store(address(curve), bytes32(REAL_ETH_SLOT), bytes32(target));
        vm.deal(address(curve), address(curve).balance + target); // back the synthetic reserves
        (,, uint256 realEth,) = curve.reserves();
        assertEq(curve.GRADUATION_ETH() - realEth, remaining, "forced remaining mismatch");
    }

    /// @notice F-1 (robbed-security gate-2 re-run): with TWO independent fee floors, `ceilDiv` can
    ///         round `acceptedEthGross` to grossIn + 1, so the checked `grossIn - acceptedEthGross`
    ///         would panic (0x11). The fix clamps `acceptedEthGross` to grossIn. Both boundary inputs
    ///         are the ones robbed-security verified. quoteBuy is a VIEW and must never revert either.
    function test_f1_clampBoundary_toy() public {
        _f1Case(199, 197); // net(199)=198>197 → clamp; ceilDiv(197·1e4/9850)=200 = grossIn+1
    }

    function test_f1_clampBoundary_realistic() public {
        // The F-1 clamp boundary depends only on (grossIn, remaining, totBps 150), NOT on G: net(grossIn)
        // exceeds `remaining` by 1 wei so the clamp fires, and ceilDiv(remaining·1e4/9850) == grossIn+1 so
        // acceptedEthGross clamps to grossIn (refund 0). remaining (1.97 ETH) sits below the G = 5.749 ETH
        // (§12.67, retargeted) target so `_forceRemaining` can position the curve there.
        _f1Case(1_999_999_999_999_999_999, 1_970_000_000_000_000_000); // accepted rounds to grossIn+1
    }

    function _f1Case(uint256 grossIn, uint256 remaining) internal {
        _deployStack(CREATOR_BPS); // treasury 100 + creator 50 → totBps 150
        (token, curve) = _createBy(creator);
        vm.warp(uint256(curve.EARLY_WINDOW_END())); // past anti-sniper so grossIn is unconstrained
        _forceRemaining(remaining);

        // (a) quoteBuy (a VIEW) must NOT revert; it clamps accepted → grossIn, refund 0.
        (uint256 qTokens,, uint256 qAccepted, uint256 qRefund) = curve.quoteBuy(grossIn);
        assertGt(qTokens, 0, "F-1 quoteBuy: no tokens");
        assertEq(qAccepted, grossIn, "F-1 quoteBuy: accepted must clamp to grossIn");
        assertEq(qRefund, 0, "F-1 quoteBuy: refund must be 0 at the boundary");

        // (b) buy() must NOT revert; lands EXACTLY on graduation; buyer keeps no refund; fees exact.
        vm.deal(alice, grossIn);
        uint256 aliceBefore = alice.balance;
        vm.prank(alice);
        uint256 gotTokens = router.buy{value: grossIn}(address(token), alice, 0, block.timestamp);
        assertGt(gotTokens, 0, "F-1 buy: no tokens");
        assertEq(aliceBefore - alice.balance, grossIn, "F-1 buy: refund must be 0 (buyer paid exactly grossIn)");
        assertEq(
            uint256(curve.phase()), uint256(IBondingCurve.Phase.ReadyToGraduate), "F-1 buy: must land on graduation"
        );
        assertEq(curve.accruedFees() + curve.accruedCreatorFees(), grossIn - remaining, "F-1: total clamp fee wrong");
        // Solvency holds exactly (balance == realEth + both escrows).
        (,, uint256 realEth,) = curve.reserves();
        assertEq(
            address(curve).balance,
            realEth + curve.accruedFees() + curve.accruedCreatorFees(),
            "F-1: solvency broken at the clamp boundary"
        );
    }

    /// @notice quoteBuy ↔ buy tokensOut parity WITH a live creator leg (gate-4 mutation kill): the
    ///         quoted tokens must equal the tokens an actual buy of the same gross delivers, proving
    ///         quoteBuy nets BOTH legs (`net = gross − fee − creatorFee`). Kills the quoteBuy
    ///         `net = gross − fee + creatorFee` mutant (invisible at cBps=0, wrong at cBps>0).
    function test_quoteBuy_tokensOutParity_withCreatorLeg() public {
        _deployStack(CREATOR_BPS);
        (token, curve) = _createBy(creator);
        vm.warp(uint256(curve.EARLY_WINDOW_END()));
        uint256 gross = 0.5 ether;
        (uint256 qTokens,,, uint256 qRefund) = curve.quoteBuy(gross);
        assertEq(qRefund, 0, "non-clamp buy expected");
        assertGt(qTokens, 0, "quote returned no tokens");
        uint256 got = _buy(alice, gross);
        assertEq(got, qTokens, "quoteBuy tokensOut != actual buy tokensOut (creator leg mis-netted)");
    }

    /// @notice Graduation-CLAMP proportional split with a LARGE, NON-ZERO creator residual (gate-4
    ///         mutation kill): a buy that overshoots graduation by ~10x lands `net = remaining` and
    ///         splits the sizeable residual `totalFee = acceptedGross − net` proportionally by bps.
    ///         Asserts the creator leg is non-zero and EXACT — kills the `totBps >= 0 ? 0` /
    ///         residual-arithmetic mutants that the tiny-residual fuzz clamps leave equivalent.
    function test_clampSplit_nonZeroCreatorLeg_exact() public {
        _deployStack(CREATOR_BPS); // totBps 150
        (token, curve) = _createBy(creator);
        vm.warp(uint256(curve.EARLY_WINDOW_END()));
        uint256 remaining = 0.1 ether; // a big remaining → a big (non-rounding) clamp residual
        _forceRemaining(remaining);

        uint256 grossIn = 1 ether; // ~10x overshoot → clamps, accepted << grossIn (no F-1 edge)
        uint256 totBps = uint256(curve.TRADE_FEE_BPS()) + CREATOR_BPS; // 150
        uint256 accepted = (remaining * BPS + (BPS - totBps) - 1) / (BPS - totBps); // ceilDiv
        uint256 totalFee = accepted - remaining;
        uint256 expCreator = (totalFee * CREATOR_BPS) / totBps;
        uint256 expTreasury = totalFee - expCreator;
        assertGt(expCreator, 0, "setup: expected a non-zero clamp creator leg");

        // quoteBuy's returned `fee` is the TREASURY leg = totalFee − creatorFee; asserting it on a
        // clamp with a non-zero creator residual kills the quoteBuy-side split mutants.
        (, uint256 qFee,, uint256 qRefund) = curve.quoteBuy(grossIn);
        assertEq(qFee, expTreasury, "quoteBuy clamp treasury leg wrong (creator residual mis-split)");
        assertGt(qRefund, 0, "quoteBuy: overshoot must refund");

        uint256 tBefore = curve.accruedFees();
        uint256 cBefore = curve.accruedCreatorFees();
        vm.deal(alice, grossIn);
        vm.prank(alice);
        router.buy{value: grossIn}(address(token), alice, 0, block.timestamp);

        assertEq(curve.accruedCreatorFees() - cBefore, expCreator, "clamp creator-leg split wrong");
        assertEq(curve.accruedFees() - tBefore, expTreasury, "clamp treasury-leg split wrong");
        assertEq(uint256(curve.phase()), uint256(IBondingCurve.Phase.ReadyToGraduate), "clamp must graduate");
    }

    // ─────────────────────── graduation with creator escrow ─────────────────────

    function test_graduation_preservesCreatorEscrow_zeroValueAfterSweeps() public {
        _deployStack(CREATOR_BPS);
        (token, curve) = _createBy(creator);
        vm.warp(uint256(curve.EARLY_WINDOW_END()));

        // Fill to graduation (lift per-token cap headroom via a single large buy).
        (,, uint256 realEth,) = curve.reserves();
        uint256 remaining = curve.GRADUATION_ETH() - realEth;
        uint256 totBps = uint256(curve.TRADE_FEE_BPS()) + curve.CREATOR_FEE_BPS();
        uint256 grossToGrad = (remaining * BPS + (BPS - totBps) - 1) / (BPS - totBps);
        _buy(alice, grossToGrad);
        assertEq(uint256(curve.phase()), uint256(IBondingCurve.Phase.ReadyToGraduate), "did not reach ReadyToGraduate");

        uint256 treasuryEscrow = curve.accruedFees();
        uint256 creatorEscrow = curve.accruedCreatorFees();
        assertGt(creatorEscrow, 0, "creator escrow should be non-zero at graduation");

        curve.graduate();
        // The curve retains exactly the two escrows (withheld from the migrator), nothing else.
        assertEq(address(curve).balance, treasuryEscrow + creatorEscrow, "curve holds value beyond the two fee escrows");

        // Both permissionless sweeps still work post-graduation → curve drains to zero value.
        curve.sweepFees();
        curve.sweepCreatorFees();
        assertEq(address(curve).balance, 0, "post-grad curve not drained to zero value");
        assertEq(vault.balanceOf(creator), creatorEscrow, "creator escrow not routed to the vault post-grad");
    }
}
