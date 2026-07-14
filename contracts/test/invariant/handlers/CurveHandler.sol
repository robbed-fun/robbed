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
import {TestRouter, MockMigrator, Reverter} from "test/harness/Harness.sol";
import {TestConstants} from "test/harness/TestConstants.sol";
import {MockArbSys} from "test/mocks/MockArbSys.sol";

/// @title CurveHandler — fuzz-actor handler for the gate-2 curve invariants
/// (gate 2; contracts.md test matrix rows 1–5 and 7)
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
    /// (contracts.md row 3: "treasury = plain EOA-like address in tests").
    address public treasury;
    /// @notice Second fee-destination EOA the `churnTreasury` admin action repoints to (also codeless,
    ///         no other inflows). Fee-exactness (row 3) sums BOTH via {sumTreasuryBalances} so a
    /// treasury churn preserves the wei-exact identity (: no trade path calls the
    ///         treasury, `sweepFees()` follows the LIVE pointer).
    address public altTreasury;
    /// @notice Factory owner stand-in (Gnosis Safe in production).
    address public safeOwner;
    /// @notice Reverting CONTRACT actor: rejects all incoming ETH. Used to prove a hostile
    ///         recipient/refundTo can only ever revert ITS OWN trade in isolation — never poison
    /// shared curve state nor freeze the curve for others.
    Reverter public hostile;

    /// @notice False until M1 `_deployStack()` wires real contracts. All actions no-op before.
    bool public wired;

    address[] internal _actors;
    address internal _currentActor;

    // ─────────────────── Ghost accounting (contracts.md) ───────────────────
    /// @notice Row 1: k after the previous action; k must never decrease across trades.
    uint256 public ghost_lastK;
    /// @notice Row 3: Σ of every in-contract fee — trade fees (both directions) + creation fee +
    ///         graduation fee. Treasury native-ETH balance must equal this to the wei.
    uint256 public ghost_feeSum;
    /// @notice Row 7: Σ actor ETH into the system (accepted buy gross + donations).
    uint256 public ghost_totalEthIn;
    /// @notice Row 7: Σ actor ETH out of the system (sell proceeds + clamp refunds), EXCLUDING
    /// treasury and caller-reward flows (excluded per contracts.md row 7).
    uint256 public ghost_totalEthOut;
    /// @notice Caller rewards paid by graduate() — tracked separately, excluded from row 7.
    uint256 public ghost_callerRewards;
    /// @notice Row 4: number of successful graduate() calls — must never exceed 1.
    uint256 public ghost_graduatedCount;
    /// @notice Row 5: ETH donated to the curve AFTER graduation (if receive() still accepts);
    ///         post-grad curve balance must equal exactly this (nothing else, nothing extractable).
    uint256 public ghost_postGradEthDonated;
    /// @notice Sells-never-pausable sentinel: set if a phase-Trading sell reverts while
    /// pauseBuys is on. Must remain false forever (contracts.md).
    bool public ghost_sellRevertedWhilePaused;

    uint256 internal constant BPS = 10_000;

    constructor() {
        for (uint256 i = 0; i < 5; ++i) {
            _actors.push(makeAddr(string(abi.encodePacked("actor", vm.toString(i)))));
        }
        treasury = makeAddr("treasury"); // EOA-like, no other inflows (row 3 wei-exactness)
        altTreasury = makeAddr("altTreasury"); // second churn destination, also codeless/no-inflow
        safeOwner = makeAddr("safeOwner");
        _deployStack();
    }

    /// @notice M1-8 wiring: MockArbSys at address(100) + CurveFactory + MockMigrator + TestRouter,
    ///         then create the subject token. Real V3/vault are M1-10 (invariant 6); the migrator is
    ///         a sink here (M1-8 owns invariants 1–5, 7). Constants from the M0 {TestConstants}
    /// fixture (contracts.md deploy order, adapted to the M1-8 surface).
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

        hostile = new Reverter(); // reverting contract-actor (isolation proof)

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

    /// @notice Curve buy through the Router (contracts.md). Ghosts: rows 1, 3, 7.
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
            // Legal buy-side reverts: pauseBuys, beta caps, anti-sniper window (,
            // contracts.md). Buys MAY fail; sells may not (see sell()).
        }
    }

    /// @notice Curve sell through the Router — must succeed for any circulating amount while
    /// Trading, regardless of any pause flag. Ghosts: rows 1, 2, 3, 7.
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
            // A phase-Trading, non-zero, min=0 sell has NO legal revert path (contracts.md).
            ghost_sellRevertedWhilePaused = buysPaused || true; // any revert here is a violation
        }
    }

    /// @notice BOUNDARY: buy sized to land exactly on GRADUATION_ETH, overshot by 1 wei to also
    /// exercise the clamp + refund path (contracts.md graduation-boundary clamp).
    function buyToGraduationEdge(uint256 actorSeed) external onlyWired useActor(actorSeed) {
        if (curve.phase() != IBondingCurve.Phase.Trading) return;
        (,, uint256 realEth,) = curve.reserves();
        uint256 remainingNet = curve.GRADUATION_ETH() - realEth;
        if (remainingNet == 0) return;
        // acceptedGross = ceilDiv(net · 10_000, 10_000 − TRADE_FEE_BPS) per contracts.md.
        uint256 denom = BPS - curve.TRADE_FEE_BPS();
        uint256 gross = (remainingNet * BPS + denom - 1) / denom + 1 wei;
        vm.deal(_currentActor, _currentActor.balance + gross);
        (uint256 expectTokens, uint256 fee, uint256 acceptedGross, uint256 refund) = curve.quoteBuy(gross);
        if (expectTokens == 0) return;
        refund; // silence unused; refunds are handled by the net-in convention below, not counted out
        try router.buy{value: gross}(address(token), _currentActor, 0, block.timestamp) returns (uint256) {
            // row-7 convention (uniform with buy()) count only the ACCEPTED (net) gross as
            // ETH-in. A clamp refund is ETH that never entered the system, so it is neither in nor
            // out — adding it to totalEthOut would double-count and (correctly) trip the identity.
            ghost_totalEthIn += acceptedGross;
            ghost_feeSum += fee;
            _recordK();
        } catch {
            // anti-sniper / caps / pauseBuys may legally block the edge fill
        }
    }

    /// @notice Permissionless pull-payment sweep. Moves accruedFees → treasury; the row-3
    ///         (treasury + accruedFees == Σ fees) and row-7 identities are invariant under it because
    ///         both `curve.balance` and `accruedFees` drop by the same swept amount.
    function sweepFees() external onlyWired {
        curve.sweepFees();
    }

    /// @notice Permissionless graduation (contracts.md). Ghosts: rows 3, 4.
    function graduate(uint256 actorSeed) external onlyWired useActor(actorSeed) {
        uint256 balBefore = _currentActor.balance;
        try curve.graduate() {
            ghost_graduatedCount += 1;
            ghost_feeSum += curve.GRADUATION_FEE(); // native-ETH leg, → treasury FIRST (step 2)
            ghost_callerRewards += _currentActor.balance - balBefore;
        } catch {
            // NotReady (phase != ReadyToGraduate) or PoolPriceUnrecoverable — curve stays
            // retriable (contracts.md step 6). Row-4 reachability is asserted in the
            // invariant contract under snapshot/revert.
        }
    }

    /// @notice ETH donation straight to the curve — never credited to reserves, swept into
    /// graduation (contracts.md receive()). Counted as ETH-in for the row-7
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
    /// graduation (contracts.md).
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
    /// timestamp-based, — never the L1-estimating NUMBER opcode).
    function warpTime(uint256 secondsForward) external onlyWired {
        secondsForward = bound(secondsForward, 1, 1 hours);
        vm.warp(block.timestamp + secondsForward);
    }

    /// @notice BOUNDARY: owner toggles pauseBuys — sells must remain unaffected.
    function setPauseBuys(bool paused) external onlyWired {
        vm.startPrank(safeOwner);
        factory.setPauseBuys(paused);
        vm.stopPrank();
    }

    /// @notice Owner toggles pauseCreates — must never touch the trade paths.
    function setPauseCreates(bool paused) external onlyWired {
        vm.startPrank(safeOwner);
        factory.setPauseCreates(paused);
        vm.stopPrank();
    }

    /// @notice CONTRACT-actor adversary (isolation). Routes trades through `hostile`,
    ///         a contract that reverts on ANY incoming ETH:
    ///         (1) a small, non-crossing BUY with recipient = hostile SUCCEEDS — LaunchToken is a plain
    ///             ERC20 (no transfer hook) so token delivery never calls back — accumulating tokens
    ///             into the hostile contract (ghosts: rows 1, 3, 7, identical to buy());
    ///         (2) a SELL with recipient = hostile REVERTS atomically (the ETH payout hits the
    ///             reverting `receive()`) and commits nothing. That is an ISOLATED failure of the
    ///             seller's OWN tx — a bad recipient, NOT a pause — so it deliberately does NOT touch
    ///             `ghost_sellRevertedWhilePaused`. The solvency / k / fee-exactness / no-extraction
    ///             invariants staying green under this action IS the proof that a reverting
    ///             recipient/refundTo cannot poison shared state or freeze the curve for anyone else.
    function hostileContractActor(uint256 ethSeed) external onlyWired {
        if (curve.phase() != IBondingCurve.Phase.Trading) return;

        // (1) Accumulate via a small buy that cannot clamp (refund == 0 ⇒ no ETH is ever sent back to
        //     `hostile`, so the only revert sources are pauseBuys/caps/early-cap — all caught).
        uint256 buyEth = bound(ethSeed, 1e14, 0.05 ether); // < MAX_EARLY_BUY, safe in/out of the window
        (uint256 expectTokens, uint256 fee, uint256 acceptedGross, uint256 refund) = curve.quoteBuy(buyEth);
        if (expectTokens != 0 && refund == 0) {
            vm.deal(address(hostile), address(hostile).balance + buyEth);
            vm.prank(address(hostile));
            try router.buy{value: buyEth}(address(token), address(hostile), 0, block.timestamp) returns (uint256) {
                ghost_totalEthIn += acceptedGross;
                ghost_feeSum += fee;
                _recordK();
            } catch {}
        }

        // (2) Reverting-recipient sell — must revert atomically, committing nothing.
        uint256 bal = token.balanceOf(address(hostile));
        if (bal == 0 || curve.phase() != IBondingCurve.Phase.Trading) return;
        vm.startPrank(address(hostile));
        token.approve(address(router), bal);
        try router.sell(address(token), bal, address(hostile), 0, block.timestamp) returns (uint256) {} catch {}
        vm.stopPrank();
        assertEq(token.balanceOf(address(hostile)), bal, "hostile sell must revert atomically (no partial commit)");
    }

    /// @notice ADMIN CHURN: owner retunes the beta caps within their valid range (both ≥ GRADUATION_ETH,
    ///         enforced by `setCaps`). Proves a cap retune never breaks solvency / k / fee-exactness /
    ///         sells and never strands graduation (the caps stay ≥ threshold, so reachability holds).
    ///         Buys tolerate the resulting cap reverts (buy() catches them); sells are never affected.
    function churnCaps(uint256 perSeed, uint256 globalSeed) external onlyWired {
        uint256 floor = curve.GRADUATION_ETH();
        uint128 perTokenEthCap = uint128(bound(perSeed, floor, type(uint128).max));
        uint128 globalEthCap = uint128(bound(globalSeed, floor, type(uint128).max));
        vm.prank(safeOwner);
        factory.setCaps(perTokenEthCap, globalEthCap);
    }

    /// @notice ADMIN CHURN: owner repoints the fee-destination treasury between two plain EOAs. Proves
    ///         a treasury churn preserves the wei-exact fee identity (row 3, summed over both via
    ///         {sumTreasuryBalances}) and never freezes a sell — no trade path calls the treasury
    /// and `sweepFees()` follows the LIVE pointer, so every fee still lands in a
    ///         tracked EOA. A reverting-contract treasury is deliberately NOT used here (it would only
    ///         revert `sweepFees()`, retriably — covered by the TM-T1 unit/fork tests).
    function churnTreasury(bool useAlt) external onlyWired {
        vm.prank(safeOwner);
        factory.setTreasury(useAlt ? altTreasury : treasury);
    }

    /// @notice DETERMINISTIC graduation driver (row 4/5 coverage). Fills the curve to GRADUATION_ETH in
    ///         one shot then graduates, so the post-graduation-zero-value invariant reaches the
    ///         Graduated phase on EVERY run instead of only when random buys happen to sum exactly onto
    ///         the threshold. Ghost accounting matches buy()+graduate(); a single graduation stays
    ///         single-fire by construction (terminal phase ⇒ a later attempt reverts, caught).
    function forceGraduate(uint256 actorSeed) external onlyWired {
        if (curve.phase() != IBondingCurve.Phase.Trading) return;
        vm.warp(uint256(curve.EARLY_WINDOW_END())); // past the anti-sniper per-tx cap
        (,, uint256 realEth,) = curve.reserves();
        uint256 remaining = curve.GRADUATION_ETH() - realEth;
        if (remaining == 0) return;
        // acceptedGross = ceilDiv(net · 10_000, 10_000 − TRADE_FEE_BPS) — CREATOR_FEE_BPS == 0 here.
        uint256 denom = BPS - curve.TRADE_FEE_BPS();
        uint256 gross = (remaining * BPS + denom - 1) / denom;
        (uint256 expectTokens, uint256 fee, uint256 acceptedGross,) = curve.quoteBuy(gross);
        if (expectTokens == 0) return;

        address filler = _actors[bound(actorSeed, 0, _actors.length - 1)];
        vm.deal(filler, filler.balance + gross);
        vm.prank(filler);
        try router.buy{value: gross}(address(token), filler, 0, block.timestamp) returns (uint256) {
            ghost_totalEthIn += acceptedGross; // clamp refund never entered the system (buy() convention)
            ghost_feeSum += fee;
            _recordK();
        } catch {
            return; // pauseBuys / caps may block this fill; a later call retries (always reachable)
        }
        if (curve.phase() != IBondingCurve.Phase.ReadyToGraduate) return;

        address caller = _actors[bound(actorSeed >> 128, 0, _actors.length - 1)];
        uint256 balBefore = caller.balance;
        vm.prank(caller);
        try curve.graduate() {
            ghost_graduatedCount += 1;
            ghost_feeSum += curve.GRADUATION_FEE(); // native-ETH leg → treasury FIRST (step 2)
            ghost_callerRewards += caller.balance - balBefore;
        } catch {}
    }

    // ─────────────────────────────── Helpers ──────────────────────────────────

    /// @notice Σ of every treasury the owner has churned through (both plain EOAs, no other inflows) —
    ///         the wei-exact fee-accounting invariant (row 3) sums this so a `setTreasury` churn keeps
    /// `Σ treasuries + accruedFees == ghost_feeSum`.
    function sumTreasuryBalances() external view returns (uint256) {
        return treasury.balance + altTreasury.balance;
    }

    /// @dev Row 1 transcription: assertGe(vE·vT, ghost_lastK) after every action
    /// (contracts.md row 1).
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
