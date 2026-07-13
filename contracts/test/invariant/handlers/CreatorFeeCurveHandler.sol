// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {CommonBase} from "forge-std/Base.sol";
import {StdAssertions} from "forge-std/StdAssertions.sol";
import {StdCheats} from "forge-std/StdCheats.sol";
import {StdUtils} from "forge-std/StdUtils.sol";

import {IBondingCurve} from "src/interfaces/IBondingCurve.sol";
import {ICurveFactory} from "src/interfaces/ICurveFactory.sol";
import {ILaunchToken} from "src/interfaces/ILaunchToken.sol";
import {IRouter} from "src/interfaces/IRouter.sol";
import {ICreatorVault} from "src/interfaces/ICreatorVault.sol";

import {CurveFactory} from "src/CurveFactory.sol";
import {CreatorVault} from "src/CreatorVault.sol";
import {CurveMath} from "src/libs/CurveMath.sol";
import {TestRouter, MockMigrator, Reverter} from "test/harness/Harness.sol";
import {TestConstants} from "test/harness/TestConstants.sol";
import {MockArbSys} from "test/mocks/MockArbSys.sol";

/// @title CreatorFeeCurveHandler — fuzz-actor handler for the Phase-2 creator-fee gate re-run
///        (spec §7, §12.63; §10 gate 2 re-opened)
/// @notice Deploys the stack with a NON-ZERO `creatorFeeBps` (the ratified testnet 50) AND a HOSTILE
///         (reverting) `creator`, then drives the same fuzz-actor sequence the gate-2 {CurveHandler}
///         does. It exists to prove the §12.63 additions preserve every gate-2 invariant when the
///         creator leg is LIVE and the creator address is adversarial:
///           - solvency now `balance ≥ realEthReserves + accruedFees + accruedCreatorFees`;
///           - exact-fee accounting covers the creator leg (vault + escrow == Σ computed creator fees);
///           - k non-decreasing, graduation single-fire, no actor extracts beyond fair value; and
///           - SELLS ALWAYS OPEN — a reverting creator can never freeze a Trading-phase sell (the
///             decisive §6.5/§12.63 property, mirrored from the TM-T1 hostile-treasury proof).
/// @dev The creator is a {Reverter} that rejects all ETH. Because no trade path touches the creator
///      or the vault (fees accrue in-contract, §12.63), every fuzzed sell must still clear; the
///      creator's own `CreatorVault.claim` is what reverts (retriable, isolated). `ghost_creatorClaimed`
///      therefore stays 0 across a hostile run, so the fee-exactness identity reduces to
///      `vault.balanceOf(creator) + accruedCreatorFees == ghost_creatorFeeSum`.
contract CreatorFeeCurveHandler is CommonBase, StdAssertions, StdCheats, StdUtils {
    uint256 internal constant BPS = 10_000;
    /// @dev `_realEthReserves` storage slot (verified via `forge inspect BondingCurve storageLayout`).
    ///      Used ONLY by {forceF1BoundaryBuy} to inject a boundary-admitting `remaining`, fully
    ///      ghost-accounted so no invariant is disturbed.
    uint256 internal constant REAL_ETH_SLOT = 2;

    IRouter public router;
    ICurveFactory public factory;
    IBondingCurve public curve;
    ILaunchToken public token;
    ICreatorVault public creatorVault;

    /// @notice EOA-like treasury with NO other inflows — makes the treasury-leg fee-exactness
    ///         wei-exact (mirrors {CurveHandler}).
    address public treasury;
    address public safeOwner;
    /// @notice The HOSTILE creator (a {Reverter}) — beneficiary of the creator-fee leg.
    address public creatorAddr;

    uint16 public creatorFeeBps;
    bool public wired;

    address[] internal _actors;
    address internal _currentActor;

    // ─────────────────── Ghost accounting (contracts.md §6 + §12.63) ───────────────────
    uint256 public ghost_lastK; // row 1
    uint256 public ghost_feeSum; // row 3 treasury leg: trade (both dirs) + creation + graduation
    uint256 public ghost_creatorFeeSum; // §12.63 creator leg: independent Σ of every creator fee
    uint256 public ghost_creatorClaimed; // creator fees paid OUT of the vault (0 under hostile creator)
    uint256 public ghost_totalEthIn; // row 7: accepted buy gross + donations
    uint256 public ghost_totalEthOut; // row 7: sell net proceeds + clamp refunds (excl. treasury/reward/creator)
    uint256 public ghost_callerRewards; // graduate() rewards, excluded from row 7
    uint256 public ghost_graduatedCount; // row 4
    uint256 public ghost_postGradEthDonated; // row 5
    uint256 public ghost_f1BoundaryHits; // F-1: times the two-floor clamp rounded accepted → grossIn
    bool public ghost_sellRevertedWhilePaused; // sells-never-pausable sentinel (spec §6.5/§12.63)

    constructor() {
        creatorFeeBps = TestConstants.CREATOR_FEE_BPS_TESTNET; // 50 — the ratified §12.63 placeholder
        for (uint256 i = 0; i < 5; ++i) {
            _actors.push(makeAddr(string(abi.encodePacked("cfActor", vm.toString(i)))));
        }
        treasury = makeAddr("cfTreasury");
        safeOwner = makeAddr("cfSafeOwner");
        _deployStack();
    }

    /// @dev Wire the stack with a non-zero creator leg + a wired CreatorVault + a HOSTILE creator.
    function _deployStack() internal {
        vm.etch(address(0x64), address(new MockArbSys()).code);

        CurveFactory f =
            new CurveFactory(TestConstants.factoryInit(treasury, safeOwner, TestConstants.WETH, creatorFeeBps));
        factory = ICurveFactory(address(f));
        MockMigrator migrator = new MockMigrator(factory);
        TestRouter r = new TestRouter(factory);
        router = IRouter(address(r));
        CreatorVault vault = new CreatorVault(address(f));
        creatorVault = ICreatorVault(address(vault));

        vm.startPrank(safeOwner);
        f.setMigrator(address(migrator));
        f.setRouter(address(r));
        f.setCreatorVault(address(vault));
        vm.stopPrank();

        // Hostile creator: a Reverter that rejects every ETH send. It is the token creator, so the
        // creator-fee leg accrues to it — but it can never receive, proving unfreezability.
        Reverter reverter = new Reverter();
        creatorAddr = address(reverter);

        uint256 creationFee = f.creationFee();
        vm.deal(creatorAddr, creationFee);
        vm.prank(creatorAddr); // creator == msg.sender == the Reverter (Router forwards it)
        (address tk, address cv,) =
            r.createToken{value: creationFee}("CFSubject", "CFS", keccak256("cf-meta"), "ipfs://cf", 0, block.timestamp);
        token = ILaunchToken(tk);
        curve = IBondingCurve(cv);

        assertEq(curve.creator(), creatorAddr, "creator not the hostile Reverter");
        assertEq(curve.CREATOR_FEE_BPS(), creatorFeeBps, "creator fee leg not snapshotted");
        assertEq(curve.creatorVault(), address(vault), "creator vault not snapshotted");

        // Creation fee: actor ETH into the system AND an in-contract fee (cancels in row 7, counts in row 3).
        ghost_feeSum += creationFee;
        ghost_totalEthIn += creationFee;
        ghost_lastK = curve.VIRTUAL_ETH_0() * curve.VIRTUAL_TOKEN_0();
        wired = true;
    }

    modifier onlyWired() {
        if (!wired) return;
        _;
    }

    modifier useActor(uint256 actorSeed) {
        _currentActor = _actors[bound(actorSeed, 0, _actors.length - 1)];
        vm.startPrank(_currentActor);
        _;
        vm.stopPrank();
    }

    // ─────────────────────────────── Actions ──────────────────────────────────

    /// @notice Buy through the Router. Tracks BOTH fee legs independently (rows 1, 3, 7 + §12.63).
    function buy(uint256 actorSeed, uint256 ethIn) external onlyWired useActor(actorSeed) {
        if (curve.phase() != IBondingCurve.Phase.Trading) return;
        ethIn = bound(ethIn, 1 wei, 100 ether);
        _doBuy(ethIn, false); // non-strict: anti-sniper / caps / pause may legally block it
    }

    /// @notice Sell through the Router — MUST succeed for any circulating amount while Trading,
    ///         regardless of the hostile creator or any pause flag (spec §6.5/§12.63).
    function sell(uint256 actorSeed, uint256 tokenAmount) external onlyWired useActor(actorSeed) {
        uint256 bal = token.balanceOf(_currentActor);
        if (bal == 0) return;
        if (curve.phase() != IBondingCurve.Phase.Trading) return;
        tokenAmount = bound(tokenAmount, 1, bal);
        (uint256 vE, uint256 vT,,) = curve.reserves();
        uint256 gross = CurveMath.sellEthOut(vE, vT, tokenAmount);
        (uint256 expectEthOut, uint256 treasuryFee) = curve.quoteSell(tokenAmount);
        if (expectEthOut == 0) return;
        uint256 expectCreatorFee = (gross * creatorFeeBps) / BPS;

        token.approve(address(router), tokenAmount);
        uint256 creatorAccruedBefore = curve.accruedCreatorFees();
        try router.sell(address(token), tokenAmount, _currentActor, 0, block.timestamp) returns (uint256 ethOut) {
            assertEq(
                curve.accruedCreatorFees() - creatorAccruedBefore,
                expectCreatorFee,
                "12.63: sell creator-fee accrual != independently-computed leg"
            );
            ghost_totalEthOut += ethOut;
            ghost_feeSum += treasuryFee;
            ghost_creatorFeeSum += expectCreatorFee;
            _recordK();
        } catch {
            // A phase-Trading, non-zero, min=0 sell has NO legal revert path — a hostile creator can
            // never freeze it (spec §6.5/§12.63). Any revert here is a violation.
            ghost_sellRevertedWhilePaused = true;
        }
    }

    /// @notice BOUNDARY: buy sized around the exact-graduation gross (offset fuzz) — exercises the
    ///         clamp + refund path with both fee legs present. The DETERMINISTIC F-1 accepted>grossIn
    ///         boundary is driven by {forceF1BoundaryBuy}; this stays a non-strict explorer.
    function buyToGraduationEdge(uint256 actorSeed, uint256 offsetSeed) external onlyWired useActor(actorSeed) {
        if (curve.phase() != IBondingCurve.Phase.Trading) return;
        (,, uint256 realEth,) = curve.reserves();
        uint256 remainingNet = curve.GRADUATION_ETH() - realEth;
        if (remainingNet == 0) return;
        uint256 totBps = uint256(curve.TRADE_FEE_BPS()) + creatorFeeBps;
        uint256 gExact = (remainingNet * BPS + (BPS - totBps) - 1) / (BPS - totBps); // ceilDiv
        int256 off = int256(bound(offsetSeed, 0, 8)) - 4; // [-4, +4] wei around the exact gross
        uint256 gross = off >= 0 ? gExact + uint256(off) : (gExact > uint256(-off) ? gExact - uint256(-off) : 1);
        if (gross == 0) return;
        _doBuy(gross, false);
    }

    /// @notice F-1 GATE COVERAGE (robbed-security gate-2 re-run): deterministically drive the exact
    ///         two-floor clamp boundary where `ceilDiv` rounds `acceptedEthGross` to grossIn + 1 (the
    ///         underflow the fix guards). Uses the security-verified pair (gross=199, remaining=197,
    ///         totBps=150). The boundary needs a specific `remaining` residue that random buys almost
    ///         never reach, so we INJECT it: set `_realEthReserves` to `GRADUATION_ETH - 197` (slot 2),
    ///         BACK it with real ETH, and COUNT the injected ETH as actor-ETH-in — which keeps
    ///         solvency, the no-extraction identity, and k all consistent (RHS/LHS both move by the
    ///         same delta; virtual reserves untouched so k is unchanged). Then buys gross=199 STRICT
    ///         (uncaught): with the fix it lands exactly on graduation with 0 refund; if the fix
    ///         regressed, the checked `grossIn - acceptedEthGross` panics UNCAUGHT and fails the run.
    function forceF1BoundaryBuy(uint256 seed) external onlyWired {
        if (curve.phase() != IBondingCurve.Phase.Trading) return;
        if (factory.pauseBuys()) return;
        // Only valid for the fixture's 150-bps two-leg split (treasury 100 + creator 50).
        if (uint256(curve.TRADE_FEE_BPS()) + creatorFeeBps != 150) return;
        uint256 windowEnd = uint256(curve.EARLY_WINDOW_END());
        if (block.timestamp < windowEnd) vm.warp(windowEnd);

        uint256 grad = curve.GRADUATION_ETH();
        uint256 rBoundary = 197; // net(199) = 198 > 197 → clamp; ceilDiv(197·1e4/9850) = 200 > 199
        if (rBoundary >= grad) return;
        uint256 injected = grad - rBoundary; // ≈ GRADUATION_ETH, so realEthPrev < injected ~always
        (,, uint256 realEthPrev,) = curve.reserves();
        if (realEthPrev >= injected) return; // only inject forward (delta > 0)
        uint256 delta = injected - realEthPrev;

        vm.store(address(curve), bytes32(uint256(REAL_ETH_SLOT)), bytes32(injected));
        vm.deal(address(curve), address(curve).balance + delta);
        ghost_totalEthIn += delta; // account the injected reserves as actor-ETH-in (keeps identities)

        _currentActor = _actors[bound(seed, 0, _actors.length - 1)];
        vm.startPrank(_currentActor);
        _doBuy(199, true); // strict: the F-1 boundary buy MUST NOT revert
        vm.stopPrank();
    }

    /// @dev Shared buy body: fully replicates {BondingCurve.buy}'s two-leg fee math (incl. the F-1
    ///      clamp) to get INDEPENDENT expected legs, executes the buy, and asserts BOTH accrual deltas
    ///      match to the wei — so the boundary where `acceptedEthGross` clamps to grossIn (refund 0 but
    ///      still a clamp) is checked correctly. `strict` = the caller guaranteed the buy is allowed,
    ///      so a revert must NOT be swallowed (F-1 coverage); otherwise legal buy reverts are caught.
    function _doBuy(uint256 gross, bool strict) internal {
        vm.deal(_currentActor, _currentActor.balance + gross);
        (uint256 expectTokens,,,) = curve.quoteBuy(gross);
        if (expectTokens == 0) return;
        (,, uint256 realEthPre,) = curve.reserves();
        (uint256 expTreasuryFee, uint256 expCreatorFee, uint256 expAcceptedGross, bool f1Boundary) =
            _expectedBuyFees(gross, realEthPre);

        uint256 treasuryBefore = curve.accruedFees();
        uint256 creatorBefore = curve.accruedCreatorFees();
        if (strict) {
            // No try/catch: a revert (e.g. the F-1 underflow panic if the fix regressed) propagates
            // uncaught and fails the invariant run under fail-on-revert.
            router.buy{value: gross}(address(token), _currentActor, 0, block.timestamp);
            _afterBuy(expTreasuryFee, expCreatorFee, expAcceptedGross, treasuryBefore, creatorBefore);
            if (f1Boundary) ghost_f1BoundaryHits += 1;
        } else {
            try router.buy{value: gross}(address(token), _currentActor, 0, block.timestamp) returns (uint256) {
                _afterBuy(expTreasuryFee, expCreatorFee, expAcceptedGross, treasuryBefore, creatorBefore);
                if (f1Boundary) ghost_f1BoundaryHits += 1;
            } catch {
                // anti-sniper / caps / pauseBuys may legally block the fill.
            }
        }
    }

    function _afterBuy(
        uint256 expTreasuryFee,
        uint256 expCreatorFee,
        uint256 expAcceptedGross,
        uint256 treasuryBefore,
        uint256 creatorBefore
    ) internal {
        assertEq(curve.accruedFees() - treasuryBefore, expTreasuryFee, "12.63: treasury-fee accrual != replicated leg");
        assertEq(
            curve.accruedCreatorFees() - creatorBefore, expCreatorFee, "12.63: creator-fee accrual != replicated leg"
        );
        ghost_totalEthIn += expAcceptedGross;
        ghost_feeSum += expTreasuryFee;
        ghost_creatorFeeSum += expCreatorFee;
        _recordK();
    }

    /// @notice Permissionless treasury-leg sweep (§12.25). Conserves rows 3/7.
    function sweepFees() external onlyWired {
        curve.sweepFees();
    }

    /// @notice Permissionless creator-leg sweep (§12.63): escrow → vault, credited to the creator.
    ///         ALWAYS succeeds even with a hostile creator (the vault deposit is a non-reverting
    ///         accumulate). Conserves the creator-leg identity: accruedCreatorFees drops by `swept`,
    ///         vault.balanceOf(creator) rises by the same.
    function sweepCreatorFees() external onlyWired {
        curve.sweepCreatorFees();
    }

    /// @notice Attempt a creator claim. Under the HOSTILE creator this always reverts (retriable,
    ///         isolated) — proven not to affect any trade. Kept as an action so the fuzzer exercises
    ///         the claim surface; a success (non-hostile) would credit `ghost_creatorClaimed`.
    function claimCreator() external onlyWired {
        uint256 bal = creatorVault.balanceOf(creatorAddr);
        try creatorVault.claim(creatorAddr) returns (uint256 paid) {
            ghost_creatorClaimed += paid;
        } catch {
            // Hostile creator rejects ETH → claim reverts, balance stays in the vault (retriable).
            assertEq(creatorVault.balanceOf(creatorAddr), bal, "claim revert must leave the vault balance intact");
        }
    }

    /// @notice Permissionless graduation (spec §6.2). Rows 3, 4.
    function graduate(uint256 actorSeed) external onlyWired useActor(actorSeed) {
        uint256 balBefore = _currentActor.balance;
        try curve.graduate() {
            ghost_graduatedCount += 1;
            ghost_feeSum += curve.GRADUATION_FEE();
            ghost_callerRewards += _currentActor.balance - balBefore;
        } catch {
            // NotReady / PoolPriceUnrecoverable — curve stays retriable.
        }
    }

    /// @notice ETH donation straight to the curve — never credited to reserves (row 7 in; row 5).
    function donateEthToCurve(uint256 actorSeed, uint256 amount) external onlyWired useActor(actorSeed) {
        amount = bound(amount, 1 wei, 10 ether);
        vm.deal(_currentActor, _currentActor.balance + amount);
        bool wasGraduated = curve.phase() == IBondingCurve.Phase.Graduated;
        (bool ok,) = address(curve).call{value: amount}("");
        if (ok) {
            ghost_totalEthIn += amount;
            if (wasGraduated) ghost_postGradEthDonated += amount;
        }
    }

    /// @notice BOUNDARY: time travel across the anti-sniper window (timestamp-based, §12.18).
    function warpTime(uint256 secondsForward) external onlyWired {
        secondsForward = bound(secondsForward, 1, 1 hours);
        vm.warp(block.timestamp + secondsForward);
    }

    /// @notice BOUNDARY: owner toggles pauseBuys — sells must remain unaffected (spec §6.5).
    function setPauseBuys(bool paused) external onlyWired {
        vm.prank(safeOwner);
        factory.setPauseBuys(paused);
    }

    // ─────────────────────────────── Helpers ──────────────────────────────────

    /// @dev FULL independent replication of {BondingCurve.buy}'s two-leg fee math — INCLUDING the F-1
    ///      clamp (`if (accepted > grossIn) accepted = grossIn`). Computed WITHOUT reading the curve's
    ///      accrual, so the fee-exactness invariant stays non-circular. Crucially it does NOT branch on
    ///      `refund` (which is 0 at the F-1 boundary even though it IS a clamp) — it re-derives the
    ///      clamp from `net_orig > remaining`, so the expected legs match the curve to the wei at the
    ///      boundary too.
    /// @return treasuryFee   Expected treasury-leg accrual.
    /// @return creatorFee    Expected creator-leg accrual.
    /// @return acceptedGross Post-clamp accepted gross (== curve).
    /// @return f1Boundary    TRUE iff the raw ceilDiv exceeded grossIn — i.e. the exact F-1 clamp
    ///                       bit fired (accepted was rounded down to grossIn). Lets the caller confirm
    ///                       the boundary was genuinely reached.
    function _expectedBuyFees(uint256 grossIn, uint256 realEthPre)
        internal
        view
        returns (uint256 treasuryFee, uint256 creatorFee, uint256 acceptedGross, bool f1Boundary)
    {
        uint256 tBps = uint256(curve.TRADE_FEE_BPS());
        uint256 cBps = creatorFeeBps;
        treasuryFee = (grossIn * tBps) / BPS;
        creatorFee = (grossIn * cBps) / BPS;
        uint256 net = grossIn - treasuryFee - creatorFee;
        uint256 remaining = curve.GRADUATION_ETH() - realEthPre;
        if (net > remaining) {
            net = remaining;
            uint256 totBps = tBps + cBps;
            uint256 rawAccepted = (net * BPS + (BPS - totBps) - 1) / (BPS - totBps); // ceilDiv (pre-clamp)
            f1Boundary = rawAccepted > grossIn;
            acceptedGross = f1Boundary ? grossIn : rawAccepted; // F-1 clamp
            uint256 totalFee = acceptedGross - net;
            creatorFee = totBps == 0 ? 0 : (totalFee * cBps) / totBps;
            treasuryFee = totalFee - creatorFee;
        } else {
            acceptedGross = grossIn;
        }
    }

    /// @dev The curve's post-both-fee net for a gross buy: `gross − floor(gross·tBps/1e4) −
    ///      floor(gross·cBps/1e4)`. Monotone increasing in `gross`; used to locate the F-1 boundary.
    function _netOf(uint256 gross) internal view returns (uint256) {
        uint256 tBps = uint256(curve.TRADE_FEE_BPS());
        return gross - (gross * tBps) / BPS - (gross * creatorFeeBps) / BPS;
    }

    function _recordK() internal {
        (uint256 vE, uint256 vT,,) = curve.reserves();
        uint256 k = vE * vT;
        assertGe(k, ghost_lastK, "gate-2 row 1 (12.63): k decreased within a single action");
        ghost_lastK = k;
    }

    function actors() external view returns (address[] memory) {
        return _actors;
    }
}
