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

import {CurveFactory} from "src/CurveFactory.sol";
import {TestRouter, MockMigrator} from "test/harness/Harness.sol";
import {TestConstants} from "test/harness/TestConstants.sol";
import {MockArbSys} from "test/mocks/MockArbSys.sol";

/// @title CurveHandler — fuzz-actor handler for the gate-2 curve invariants
///        (spec §10 gate 2; contracts.md §6 test matrix rows 1–5 and 7)
/// @notice TESTS-AS-SPEC SKELETON. Every action is written out against the frozen interfaces and
///         transcribes the documented ghost-accounting approach, but early-returns via
///         `onlyWired` until M1 wires real deployments in `_deployStack()` and flips
///         `wired = true`. Boundary states covered by dedicated actions: graduation edge
///         (`buyToGraduationEdge`), paused buys (`setPauseBuys` — proving sells unaffected),
///         anti-sniper window crossing (`warpTime`), donations (ETH + tokens), permissionless
///         graduation.
/// @dev Not a test contract on purpose (no Test inheritance): keeps the fuzz-target surface to
///      the action functions below. Assertion failures inside actions require
///      `fail_on_revert = true` for this suite once wired (M1 obligation — noted in each
///      invariant contract's setUp).
contract CurveHandler is CommonBase, StdAssertions, StdCheats, StdUtils {
    // ─────────────────────────── System under test ────────────────────────────
    IRouter public router;
    ICurveFactory public factory;
    IBondingCurve public curve;
    ILaunchToken public token;
    /// @notice EOA-like address with NO other inflows — makes gate-2 row 3 exact-to-the-wei
    ///         (contracts.md §6 row 3: "treasury = plain EOA-like address in tests").
    address public treasury;
    /// @notice Factory owner stand-in (Gnosis Safe in production, spec §6.6).
    address public safeOwner;

    /// @notice False until M1 `_deployStack()` wires real contracts. All actions no-op before.
    bool public wired;

    address[] internal _actors;
    address internal _currentActor;

    // ─────────────────── Ghost accounting (contracts.md §6) ───────────────────
    /// @notice Row 1: k after the previous action; k must never decrease across trades.
    uint256 public ghost_lastK;
    /// @notice Row 3: Σ of every in-contract fee — trade fees (both directions) + creation fee +
    ///         graduation fee. Treasury native-ETH balance must equal this to the wei.
    uint256 public ghost_feeSum;
    /// @notice Row 7: Σ actor ETH into the system (accepted buy gross + donations).
    uint256 public ghost_totalEthIn;
    /// @notice Row 7: Σ actor ETH out of the system (sell proceeds + clamp refunds), EXCLUDING
    ///         treasury and caller-reward flows (excluded per contracts.md §6 row 7).
    uint256 public ghost_totalEthOut;
    /// @notice Caller rewards paid by graduate() — tracked separately, excluded from row 7.
    uint256 public ghost_callerRewards;
    /// @notice Row 4: number of successful graduate() calls — must never exceed 1.
    uint256 public ghost_graduatedCount;
    /// @notice Row 5: ETH donated to the curve AFTER graduation (if receive() still accepts);
    ///         post-grad curve balance must equal exactly this (nothing else, nothing extractable).
    uint256 public ghost_postGradEthDonated;
    /// @notice Sells-never-pausable sentinel: set if a phase-Trading sell reverts while
    ///         pauseBuys is on. Must remain false forever (spec §6.5; contracts.md §5.3).
    bool public ghost_sellRevertedWhilePaused;

    uint256 internal constant BPS = 10_000;

    constructor() {
        for (uint256 i = 0; i < 5; ++i) {
            _actors.push(makeAddr(string(abi.encodePacked("actor", vm.toString(i)))));
        }
        treasury = makeAddr("treasury"); // EOA-like, no other inflows (row 3 wei-exactness)
        safeOwner = makeAddr("safeOwner");
        _deployStack();
    }

    /// @notice M1-8 wiring: MockArbSys at address(100) + CurveFactory + MockMigrator + TestRouter,
    ///         then create the subject token. Real V3/vault are M1-10 (invariant 6); the migrator is
    ///         a sink here (M1-8 owns invariants 1–5, 7). Constants from the M0 {TestConstants}
    ///         fixture (contracts.md §7.2 deploy order, adapted to the M1-8 surface).
    function _deployStack() internal {
        // ArbSys stand-in (anti-sniper is timestamp-based, so this is parity-only for M1-8).
        vm.etch(address(0x64), address(new MockArbSys()).code);

        CurveFactory f = new CurveFactory(TestConstants.factoryInit(treasury, safeOwner));
        factory = ICurveFactory(address(f));
        MockMigrator migrator = new MockMigrator(factory);
        TestRouter r = new TestRouter(factory);
        router = IRouter(address(r));

        vm.startPrank(safeOwner);
        f.setMigrator(address(migrator));
        f.setRouter(address(r));
        vm.stopPrank();

        // Create the subject token with NO initial buy (fuzz actors do all trading).
        uint256 creationFee = f.creationFee();
        vm.deal(address(this), address(this).balance + creationFee);
        (address tk, address cv,) =
            r.createToken{value: creationFee}("Subject", "SUBJ", keccak256("meta"), "ipfs://m", 0, block.timestamp);
        token = ILaunchToken(tk);
        curve = IBondingCurve(cv);

        // Ghost seeding: creation fee is actor ETH into the system AND an in-contract fee, so it
        // appears on both sides of the row-7 identity (cancels) and in the row-3 fee sum.
        ghost_feeSum += creationFee;
        ghost_totalEthIn += creationFee;
        ghost_lastK = curve.VIRTUAL_ETH_0() * curve.VIRTUAL_TOKEN_0();

        wired = true;
    }

    // ────────────────────────────── Modifiers ─────────────────────────────────

    /// @dev Pending-implementation guard: every action no-ops until M1 wires the stack.
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

    /// @notice Curve buy through the Router (contracts.md §3.2). Ghosts: rows 1, 3, 7.
    function buy(uint256 actorSeed, uint256 ethIn) external onlyWired useActor(actorSeed) {
        if (curve.phase() != IBondingCurve.Phase.Trading) return;
        ethIn = bound(ethIn, 1 wei, 100 ether);
        vm.deal(_currentActor, _currentActor.balance + ethIn);
        (uint256 expectTokens, uint256 fee, uint256 acceptedGross,) = curve.quoteBuy(ethIn);
        if (expectTokens == 0) return;
        try router.buy{value: ethIn}(address(token), _currentActor, 0, block.timestamp) returns (uint256) {
            // Refund (graduation clamp) never entered the system: count accepted gross only.
            ghost_totalEthIn += acceptedGross;
            ghost_feeSum += fee;
            _recordK();
        } catch {
            // Legal buy-side reverts: pauseBuys, beta caps, anti-sniper window (spec §6.5,
            // contracts.md §5.7). Buys MAY fail; sells may not (see sell()).
        }
    }

    /// @notice Curve sell through the Router — must succeed for any circulating amount while
    ///         Trading, regardless of any pause flag (spec §6.5). Ghosts: rows 1, 2, 3, 7.
    function sell(uint256 actorSeed, uint256 tokenAmount) external onlyWired useActor(actorSeed) {
        uint256 bal = token.balanceOf(_currentActor);
        if (bal == 0) return;
        if (curve.phase() != IBondingCurve.Phase.Trading) return;
        tokenAmount = bound(tokenAmount, 1, bal);
        (uint256 expectEthOut, uint256 fee) = curve.quoteSell(tokenAmount);
        if (expectEthOut == 0) return;
        token.approve(address(router), tokenAmount);
        bool buysPaused = factory.pauseBuys();
        try router.sell(address(token), tokenAmount, _currentActor, 0, block.timestamp) returns (uint256 ethOut) {
            ghost_totalEthOut += ethOut;
            ghost_feeSum += fee;
            _recordK();
        } catch {
            // A phase-Trading, non-zero, min=0 sell has NO legal revert path (contracts.md §2.3).
            ghost_sellRevertedWhilePaused = buysPaused || true; // any revert here is a violation
        }
    }

    /// @notice BOUNDARY: buy sized to land exactly on GRADUATION_ETH, overshot by 1 wei to also
    ///         exercise the clamp + refund path (contracts.md §2.3 graduation-boundary clamp).
    function buyToGraduationEdge(uint256 actorSeed) external onlyWired useActor(actorSeed) {
        if (curve.phase() != IBondingCurve.Phase.Trading) return;
        (,, uint256 realEth,) = curve.reserves();
        uint256 remainingNet = curve.GRADUATION_ETH() - realEth;
        if (remainingNet == 0) return;
        // acceptedGross = ceilDiv(net · 10_000, 10_000 − TRADE_FEE_BPS) per contracts.md §2.3.
        uint256 denom = BPS - curve.TRADE_FEE_BPS();
        uint256 gross = (remainingNet * BPS + denom - 1) / denom + 1 wei;
        vm.deal(_currentActor, _currentActor.balance + gross);
        (uint256 expectTokens, uint256 fee, uint256 acceptedGross, uint256 refund) = curve.quoteBuy(gross);
        if (expectTokens == 0) return;
        refund; // silence unused; refunds are handled by the net-in convention below, not counted out
        try router.buy{value: gross}(address(token), _currentActor, 0, block.timestamp) returns (uint256) {
            // §12.25 row-7 convention (uniform with buy()): count only the ACCEPTED (net) gross as
            // ETH-in. A clamp refund is ETH that never entered the system, so it is neither in nor
            // out — adding it to totalEthOut would double-count and (correctly) trip the identity.
            ghost_totalEthIn += acceptedGross;
            ghost_feeSum += fee;
            _recordK();
        } catch {
            // anti-sniper / caps / pauseBuys may legally block the edge fill
        }
    }

    /// @notice Permissionless pull-payment sweep (§12.25). Moves accruedFees → treasury; the row-3
    ///         (treasury + accruedFees == Σ fees) and row-7 identities are invariant under it because
    ///         both `curve.balance` and `accruedFees` drop by the same swept amount.
    function sweepFees() external onlyWired {
        curve.sweepFees();
    }

    /// @notice Permissionless graduation (spec §6.2; contracts.md §3.4). Ghosts: rows 3, 4.
    function graduate(uint256 actorSeed) external onlyWired useActor(actorSeed) {
        uint256 balBefore = _currentActor.balance;
        try curve.graduate() {
            ghost_graduatedCount += 1;
            ghost_feeSum += curve.GRADUATION_FEE(); // native-ETH leg, → treasury FIRST (§3.4 step 2)
            ghost_callerRewards += _currentActor.balance - balBefore;
        } catch {
            // NotReady (phase != ReadyToGraduate) or PoolPriceUnrecoverable — curve stays
            // retriable (contracts.md §3.4 step 6). Row-4 reachability is asserted in the
            // invariant contract under snapshot/revert.
        }
    }

    /// @notice ETH donation straight to the curve — never credited to reserves, swept into
    ///         graduation (contracts.md §2.3 receive(), §5.7). Counted as ETH-in for the row-7
    ///         identity; post-grad donations tracked for row 5.
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

    /// @notice Token donation straight to the curve — ignored by curve math, burned as dust at
    ///         graduation (contracts.md §5.7).
    function donateTokensToCurve(uint256 actorSeed, uint256 amount) external onlyWired useActor(actorSeed) {
        // Guard post-graduation: after graduate() the curve holds 0 tokens (row 5). A token donation
        // to a terminal curve is inert griefing-of-self and would confound the strict zero-token
        // assertion without adding coverage — pre-graduation donations already exercise the sweep.
        if (curve.phase() == IBondingCurve.Phase.Graduated) return;
        uint256 bal = token.balanceOf(_currentActor);
        if (bal == 0) return;
        amount = bound(amount, 1, bal);
        token.transfer(address(curve), amount);
    }

    /// @notice BOUNDARY: time travel across the anti-sniper window end (EARLY_WINDOW_END is
    ///         timestamp-based, spec §12.18 — never the L1-estimating NUMBER opcode).
    function warpTime(uint256 secondsForward) external onlyWired {
        secondsForward = bound(secondsForward, 1, 1 hours);
        vm.warp(block.timestamp + secondsForward);
    }

    /// @notice BOUNDARY: owner toggles pauseBuys — sells must remain unaffected (spec §6.5).
    function setPauseBuys(bool paused) external onlyWired {
        vm.startPrank(safeOwner);
        factory.setPauseBuys(paused);
        vm.stopPrank();
    }

    /// @notice Owner toggles pauseCreates — must never touch the trade paths (spec §6.5).
    function setPauseCreates(bool paused) external onlyWired {
        vm.startPrank(safeOwner);
        factory.setPauseCreates(paused);
        vm.stopPrank();
    }

    // ─────────────────────────────── Helpers ──────────────────────────────────

    /// @dev Row 1 transcription: assertGe(vE·vT, ghost_lastK) after every action
    ///      (contracts.md §6 row 1).
    function _recordK() internal {
        (uint256 vE, uint256 vT,,) = curve.reserves();
        uint256 k = vE * vT;
        assertGe(k, ghost_lastK, "gate-2 row 1: k decreased within a single action");
        ghost_lastK = k;
    }

    /// @notice All fuzz actors (drain checks in the solvency invariant iterate these).
    function actors() external view returns (address[] memory) {
        return _actors;
    }
}
