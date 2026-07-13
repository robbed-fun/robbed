// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

import {IBondingCurve} from "./interfaces/IBondingCurve.sol";
import {ICurveFactory} from "./interfaces/ICurveFactory.sol";
import {IV3Migrator} from "./interfaces/IV3Migrator.sol";
import {ICreatorVault} from "./interfaces/ICreatorVault.sol";
import {CurveMath} from "./libs/CurveMath.sol";

import {
    NotRouter,
    NotTrading,
    NotReady,
    ZeroAmount,
    SlippageExceeded,
    EarlyBuyCapExceeded,
    PerTokenCapExceeded,
    EthTransferFailed
} from "./errors/Errors.sol";

/// @title BondingCurve — virtual-reserve constant-product curve with in-contract pull-payment fees
///        (spec §6.2, §6.4, §6.5, §12.11, §12.12, §12.18, §12.25; contracts.md §2.3, §3.2–3.4)
/// @notice One instance per token, CREATE2-deployed by {CurveFactory} with a constant init-code
///         hash (it takes NO constructor args and reads its parameters back from the factory). Holds
///         the full 1B supply at birth and every wei of raised ETH. All fees are computed HERE, in
///         contract — never caller-supplied (spec §4.1). Only the Router may trade; `graduate()`
///         and `sweepFees()` are permissionless.
///
/// @dev Three load-bearing engineering decisions (recorded for the hoodpad-security gate):
///
///      1. **Pull-payment fee escrow (§12.25 — THE mechanism that makes sells unfreezable).**
///         The treasury ETH-leg fee is added to the `accruedFees` accumulator on both buys and sells
///         and is NEVER pushed to the treasury on any trade path. A separate permissionless,
///         non-phase-gated `sweepFees()` pulls it to the live treasury. **The Phase-2 creator-fee leg
///         (spec §7, §12.63) mirrors this discipline EXACTLY:** it is an ADDITIVE second ETH-leg fee
///         (`accruedCreatorFees`), taken on both directions under the same ≤2% hard cap
///         (`TRADE_FEE_BPS + CREATOR_FEE_BPS ≤ 200`, enforced by the factory), accrued in-contract
///         during the trade, and pushed out ONLY by the separate permissionless `sweepCreatorFees()`
///         → CreatorVault. No trade path calls the treasury OR the creator OR the vault, so neither a
///         hostile treasury (§12.25) nor a hostile creator (§12.63) can freeze a buy or a sell. At
///         `CREATOR_FEE_BPS == 0` the creator leg is inert and every path is byte-identical to the
///         treasury-only v1. Alternatives weighed:
///         (a) push the fee to the treasury inside each trade (the Gnad/original design) — rejected
///         because it makes every sell depend on the treasury accepting ETH, so an owner or a
///         compromised signer pointing `treasury` at a reverting contract silently becomes a
///         sell-freeze backdoor (threat-model UM-1); (b) push only on buys, accrue on sells —
///         rejected as asymmetric and still leaks a treasury dependency into a value path. The
///         pull model mirrors the audited `LPFeeVault.collect()` pattern (pull-over-push is the
///         canonical OZ guidance for untrusted recipients) and is what restores the §6.5 "sells
///         always open" guarantee *by construction*: grep this contract — no trade function calls
///         `treasury`. Protected invariant: solvency `balance >= realEthReserves + accruedFees`.
///
///      2. **Reentrancy: OZ v5 storage-based `ReentrancyGuard` + strict CEI (finding T-3).** Every
///         externally reachable state-mutating entrypoint — `buy`, `sell`, `sweepFees`, `graduate`
///         — is `nonReentrant`, and each writes ALL state (phase, reserves, `accruedFees`) before
///         any external call (ETH send / token transfer / migrator call). Consequence: a refund or
///         payout callback that re-enters `graduate()` mid-buy hits the shared guard (or, post-flow,
///         the terminal `NotReady`/`NotTrading` phase check); a re-entrant `sweepFees()` would see
///         `accruedFees == 0`. Chosen the storage-based guard over `ReentrancyGuardTransient`
///         deliberately: v1 makes no EIP-1153/Cancun availability assumption on ArbOS (foundry.toml
///         §7.1). A malicious `recipient`/`refundTo` that reverts on receive only reverts THEIR OWN
///         trade — no shared state is poisoned (spec §5.4).
///
///      3. **CREATE2 constant-init-code contract with a factory-callback constructor.** No
///         constructor args ⇒ the factory can precompute this address and mint the token supply
///         here before deployment (see {CurveFactory} decision #1). Immutables are hydrated once
///         from `ICurveFactory(msg.sender).curveParameters()` — a snapshot, so a later owner retune
///         of curve economics cannot touch this live curve (spec §6.4).
contract BondingCurve is IBondingCurve, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 private constant BPS_DENOMINATOR = 10_000;

    // ─────────────────────────────── Immutables ────────────────────────────────

    /// @notice The deploying {CurveFactory} — source of the live treasury/pause/cap reads.
    address public immutable factory;
    /// @notice The only address permitted to call `buy`/`sell` (internal-trust boundary).
    address public immutable router;
    /// @notice The graduation executor that receives the LP tranche + raised ETH.
    address public immutable migrator;

    /// @inheritdoc IBondingCurve
    address public immutable override token;
    /// @inheritdoc IBondingCurve
    uint256 public immutable override VIRTUAL_ETH_0;
    /// @inheritdoc IBondingCurve
    uint256 public immutable override VIRTUAL_TOKEN_0;
    /// @inheritdoc IBondingCurve
    uint256 public immutable override CURVE_SUPPLY;
    /// @inheritdoc IBondingCurve
    uint256 public immutable override LP_TOKEN_TRANCHE;
    /// @inheritdoc IBondingCurve
    uint256 public immutable override GRADUATION_ETH;
    /// @inheritdoc IBondingCurve
    uint16 public immutable override TRADE_FEE_BPS;
    /// @inheritdoc IBondingCurve
    uint16 public immutable override CREATOR_FEE_BPS;
    /// @inheritdoc IBondingCurve
    address public immutable override creator;
    /// @inheritdoc IBondingCurve
    address public immutable override creatorVault;
    /// @inheritdoc IBondingCurve
    uint256 public immutable override GRADUATION_FEE;
    /// @inheritdoc IBondingCurve
    uint256 public immutable override CALLER_REWARD;
    /// @inheritdoc IBondingCurve
    uint64 public immutable override EARLY_WINDOW_END;
    /// @inheritdoc IBondingCurve
    uint128 public immutable override MAX_EARLY_BUY;
    /// @inheritdoc IBondingCurve
    uint64 public immutable override createdAt;

    // ──────────────────────────────── Storage ──────────────────────────────────

    uint256 internal _virtualEthReserves;
    uint256 internal _virtualTokenReserves;
    uint256 internal _realEthReserves;
    uint256 internal _realTokenReserves; // tokens still available for sale (init CURVE_SUPPLY)

    /// @inheritdoc IBondingCurve
    uint256 public override accruedFees; // unswept treasury ETH-leg trade fees (§12.25)
    /// @inheritdoc IBondingCurve
    uint256 public override accruedCreatorFees; // unswept creator ETH-leg fees (§7, §12.63)
    /// @inheritdoc IBondingCurve
    Phase public override phase;

    // ─────────────────────────────── Constructor ───────────────────────────────

    /// @dev No arguments — the factory stages the parameters and this reads them back, keeping the
    ///      CREATE2 init-code hash constant (contracts.md §2.2). `createdAt`/`EARLY_WINDOW_END` are
    ///      `block.timestamp`-based (spec §12.18) — NEVER the L1-estimating block-height opcode.
    constructor() {
        factory = msg.sender;
        ICurveFactory.CurveParameters memory p = ICurveFactory(msg.sender).curveParameters();

        token = p.token;
        router = p.router;
        migrator = p.migrator;
        creator = p.creator;
        creatorVault = p.creatorVault;

        VIRTUAL_ETH_0 = p.virtualEth0;
        VIRTUAL_TOKEN_0 = p.virtualToken0;
        CURVE_SUPPLY = p.curveSupply;
        LP_TOKEN_TRANCHE = p.lpTranche;
        GRADUATION_ETH = p.graduationEth;
        TRADE_FEE_BPS = p.tradeFeeBps;
        CREATOR_FEE_BPS = p.creatorFeeBps;
        GRADUATION_FEE = p.graduationFee;
        CALLER_REWARD = p.callerReward;
        MAX_EARLY_BUY = p.maxEarlyBuyWei;

        uint64 nowTs = uint64(block.timestamp);
        createdAt = nowTs;
        EARLY_WINDOW_END = nowTs + p.earlyWindowSeconds;

        // Seed reserves. `CREATOR_FEE_BPS` (§7, §12.63) is snapshotted above; at 0 (v1/mainnet) the
        // creator leg is inert and every path is byte-identical to the treasury-only build.
        _virtualEthReserves = p.virtualEth0;
        _virtualTokenReserves = p.virtualToken0;
        _realTokenReserves = p.curveSupply;
        phase = Phase.Trading;
    }

    // ─────────────────────────────── Trading ───────────────────────────────────

    /// @inheritdoc IBondingCurve
    function buy(address trader, address recipient, address refundTo, uint256 minTokensOut)
        external
        payable
        override
        nonReentrant
        returns (uint256 tokensOut, uint256 acceptedEthGross, uint256 fee)
    {
        if (msg.sender != router) revert NotRouter();
        if (phase != Phase.Trading) revert NotTrading();
        uint256 grossIn = msg.value;
        if (grossIn == 0) revert ZeroAmount();

        // §12.18 anti-sniper: per-tx gross cap inside the timestamp window (never the height opcode).
        if (block.timestamp < EARLY_WINDOW_END && grossIn > MAX_EARLY_BUY) {
            revert EarlyBuyCapExceeded(grossIn, MAX_EARLY_BUY);
        }

        // Two ADDITIVE in-contract ETH-leg fees (spec §4.1 — never caller-supplied): the treasury leg
        // (`fee` → accruedFees, §12.25) and the Phase-2 creator leg (`creatorFee` → accruedCreatorFees,
        // §7/§12.63). Both floored independently; `TRADE_FEE_BPS + CREATOR_FEE_BPS ≤ 200` is guaranteed
        // by the factory. At CREATOR_FEE_BPS == 0 the creator term is 0 and `net` matches the
        // treasury-only build to the wei. The bps/clamp temporaries are scoped in a block (freed) so
        // this frame stays shallow enough to compile without via-IR (keeps verified bytecode stable,
        // contracts.md §2.4 / decision-#3 stack-depth management).
        uint256 net;
        uint256 refund;
        uint256 creatorFee;
        {
            uint16 tBps = TRADE_FEE_BPS;
            uint16 cBps = CREATOR_FEE_BPS;
            fee = (grossIn * tBps) / BPS_DENOMINATOR;
            creatorFee = (grossIn * cBps) / BPS_DENOMINATOR;
            net = grossIn - fee - creatorFee;

            // §12.11 graduation-boundary clamp: a buy may not push net real reserves past GRADUATION_ETH.
            uint256 remaining = GRADUATION_ETH - _realEthReserves; // > 0 while Trading (see below)
            if (net > remaining) {
                net = remaining;
                uint16 totBps = tBps + cBps;
                acceptedEthGross = Math.ceilDiv(net * BPS_DENOMINATOR, BPS_DENOMINATOR - totBps);
                // F-1 (robbed-security gate-2 re-run): with TWO independent fee floors, pre-clamp `net`
                // can sit up to 1 wei above the single-floor value, so this ceilDiv can round
                // `acceptedEthGross` to grossIn + 1 — which would panic the checked `grossIn -
                // acceptedEthGross`. Clamp to grossIn: `net` stays == remaining (still lands EXACTLY on
                // GRADUATION_ETH), the two fee legs come out at most 1 wei lower, refund is 0, no dust.
                // At cBps == 0 (single floor) acceptedEthGross <= grossIn is provable, so this is a
                // no-op there — byte-identical to the treasury-only clamp.
                if (acceptedEthGross > grossIn) acceptedEthGross = grossIn;
                uint256 totalFee = acceptedEthGross - net; // exact-fee-on-clamp definition (§12.11)
                // Split the clamp residual proportionally by bps so treasury + creator == totalFee to
                // the wei (net + fee + creatorFee == acceptedEthGross exactly). At cBps == 0 →
                // creatorFee 0, fee == totalFee: identical to the single-leg clamp. `totBps == 0` guard
                // avoids /0 when an owner set both legs to 0 (then totalFee is 0 anyway).
                creatorFee = totBps == 0 ? 0 : (totalFee * cBps) / totBps;
                fee = totalFee - creatorFee;
                refund = grossIn - acceptedEthGross;
            } else {
                acceptedEthGross = grossIn;
            }
        }

        // Beta caps (buy-side only, LIVE read). perTokenEthCap in the curve; globalEthCap enforced
        // inside factory.recordEthDelta on the positive delta. Neither can ever block a sell.
        uint256 newRealEth = _realEthReserves + net;
        if (newRealEth > ICurveFactory(factory).perTokenEthCap()) revert PerTokenCapExceeded();
        ICurveFactory(factory).recordEthDelta(int256(net));

        // Curve math (net ETH in); rounding favors the curve. Defensive cap to sellable inventory:
        // non-binding except at <=dust near graduation, and curve-favoring (only raises k), so it is
        // applied BEFORE the slippage check to never pay out fewer than the caller's floor silently.
        tokensOut = CurveMath.buyTokensOut(_virtualEthReserves, _virtualTokenReserves, net);
        uint256 realTok = _realTokenReserves;
        if (tokensOut > realTok) tokensOut = realTok;
        if (tokensOut < minTokensOut) revert SlippageExceeded(tokensOut, minTokensOut);

        // ── Effects (CEI): all state written before any external call ──
        _virtualEthReserves += net;
        _virtualTokenReserves -= tokensOut;
        _realEthReserves = newRealEth;
        _realTokenReserves = realTok - tokensOut;
        accruedFees += fee; // NO treasury push (§12.25)
        accruedCreatorFees += creatorFee; // NO creator/vault push on the trade path (§12.63)
        bool crossed = newRealEth == GRADUATION_ETH;
        if (crossed) phase = Phase.ReadyToGraduate; // two-way lock (§12.12)

        // ── Interactions: refund → refundTo, tokens → recipient. No treasury call. ──
        if (refund != 0) _sendEth(refundTo, refund);
        IERC20(token).safeTransfer(recipient, tokensOut);

        emit Trade(
            trader, true, acceptedEthGross, tokensOut, fee, _virtualEthReserves, _virtualTokenReserves, _realEthReserves
        );
        if (crossed) emit GraduationReady(_realEthReserves);
    }

    /// @inheritdoc IBondingCurve
    /// @dev NO pause flag is read on this path and NO treasury call is made — sells are unfreezable
    ///      by construction (spec §6.5, §12.25). The Router has already moved `tokenAmount` into
    ///      this curve before calling.
    function sell(address trader, address recipient, uint256 tokenAmount, uint256 minEthOut)
        external
        override
        nonReentrant
        returns (uint256 ethOut, uint256 fee)
    {
        if (msg.sender != router) revert NotRouter();
        if (phase != Phase.Trading) revert NotTrading();
        if (tokenAmount == 0) revert ZeroAmount();

        uint256 ethOutGross = CurveMath.sellEthOut(_virtualEthReserves, _virtualTokenReserves, tokenAmount);
        // Both ETH-leg fees taken on the sell side too (spec §6.2 "both directions"). Treasury leg
        // (`fee`) and creator leg (`creatorFee`) floored independently; net is what the seller keeps.
        // At CREATOR_FEE_BPS == 0 → creatorFee 0, ethOut == ethOutGross - fee: identical to v1.
        fee = (ethOutGross * TRADE_FEE_BPS) / BPS_DENOMINATOR;
        uint256 creatorFee = (ethOutGross * CREATOR_FEE_BPS) / BPS_DENOMINATOR;
        ethOut = ethOutGross - fee - creatorFee;
        if (ethOut < minEthOut) revert SlippageExceeded(ethOut, minEthOut);

        // ── Effects: reserves + accrued fees written before the payout. `_realEthReserves` cannot
        // underflow: sellable circulating tokens <= tokens ever bought, and k is non-decreasing, so
        // ethOutGross <= _realEthReserves for any legitimately-held `tokenAmount` (report proof). ──
        _virtualTokenReserves += tokenAmount;
        _virtualEthReserves -= ethOutGross;
        _realTokenReserves += tokenAmount;
        _realEthReserves -= ethOutGross;
        accruedFees += fee; // NO treasury push (§12.25)
        accruedCreatorFees += creatorFee; // NO creator/vault push on the trade path (§12.63)

        // Curve ETH exits the global beta-cap sum; negative delta NEVER reverts (contracts.md §5.3).
        ICurveFactory(factory).recordEthDelta(-int256(ethOutGross));

        // ── Interaction: pay the seller net. No treasury call. ──
        _sendEth(recipient, ethOut);

        emit Trade(
            trader, false, ethOutGross, tokenAmount, fee, _virtualEthReserves, _virtualTokenReserves, _realEthReserves
        );
    }

    // ─────────────────────────── Fee escrow (§12.25) ────────────────────────────

    /// @inheritdoc IBondingCurve
    function sweepFees() external override nonReentrant returns (uint256 swept) {
        swept = accruedFees;
        accruedFees = 0; // effect before interaction (CEI); a revert below restores it (retriable)
        address treasury = ICurveFactory(factory).treasury(); // live pointer, mirrors LPFeeVault
        if (swept != 0) _sendEth(treasury, swept);
        emit FeesSwept(treasury, swept);
    }

    /// @inheritdoc IBondingCurve
    /// @dev Mirrors {sweepFees} but pushes the creator leg to the CreatorVault (a TRUSTED, non-
    ///      reverting accumulate — {ICreatorVault.deposit} just credits `creator`), so this ALWAYS
    ///      clears the escrow regardless of creator behavior. CEI: zero `accruedCreatorFees` before
    ///      the push. `creatorVault` is guaranteed non-zero whenever this can carry value (a curve is
    ///      created with `CREATOR_FEE_BPS != 0` only when the factory's CreatorVault is wired —
    ///      {CurveFactory} createToken guard), and at `CREATOR_FEE_BPS == 0` `swept` is always 0 so
    ///      no push happens even if `creatorVault` is address(0).
    function sweepCreatorFees() external override nonReentrant returns (uint256 swept) {
        swept = accruedCreatorFees;
        accruedCreatorFees = 0; // effect before interaction (CEI)
        address vault = creatorVault;
        if (swept != 0) ICreatorVault(vault).deposit{value: swept}(creator);
        emit CreatorFeesSwept(creator, vault, swept);
    }

    // ─────────────────────────────── Graduation ────────────────────────────────

    /// @inheritdoc IBondingCurve
    function graduate() external override nonReentrant {
        if (phase != Phase.ReadyToGraduate) revert NotReady();

        // ── Effects: terminal phase + zeroed reserves BEFORE any external call (single-fire by
        // construction; a re-entrant graduate() hits nonReentrant or this NotReady check). ──
        uint256 gradEth = _realEthReserves; // == GRADUATION_ETH by the ReadyToGraduate invariant
        phase = Phase.Graduated;
        _realEthReserves = 0;
        _realTokenReserves = 0;
        // Curve ETH exits the global beta-cap sum (X-12); negative delta never reverts.
        ICurveFactory(factory).recordEthDelta(-int256(gradEth));

        // ── Interactions ──
        // Caller reward first. If msg.sender rejects ETH the whole graduation reverts and stays
        // retriable by anyone else — a griefer cannot lock graduation for everyone this way.
        _sendEth(msg.sender, CALLER_REWARD);

        // Entire token balance (LP tranche + any donated/dust tokens) → migrator.
        IERC20 t = IERC20(token);
        t.safeTransfer(migrator, t.balanceOf(address(this)));

        // Entire ETH balance MINUS both unswept fee escrows (treasury leg withheld for sweepFees
        // §12.25; creator leg withheld for sweepCreatorFees §12.63) → migrator. Solvency guarantees
        // balance >= accruedFees + accruedCreatorFees, so this cannot underflow; it leaves the curve
        // holding exactly the two escrows, each drained to 0 by its permissionless sweep → the
        // post-graduation "zero value" invariant (unswept fees excluded, §12.25/§12.63).
        uint256 ethForMigrator = address(this).balance - accruedFees - accruedCreatorFees;
        IV3Migrator(migrator).migrate{value: ethForMigrator}(token);
        // `Graduated` is emitted by the migrator (canonical event home, contracts.md §2.5).
    }

    // ──────────────────────────────── Views ────────────────────────────────────

    /// @inheritdoc IBondingCurve
    function quoteBuy(uint256 ethInGross)
        external
        view
        override
        returns (uint256 tokensOut, uint256 fee, uint256 acceptedEthGross, uint256 refund)
    {
        if (phase != Phase.Trading || ethInGross == 0) return (0, 0, 0, 0);
        // Mirrors buy(): `fee` is the TREASURY leg; the creator leg is netted out so `tokensOut`
        // reflects the true post-both-fees `net`. At CREATOR_FEE_BPS == 0 → identical to v1.
        uint16 tBps = TRADE_FEE_BPS;
        uint16 cBps = CREATOR_FEE_BPS;
        fee = (ethInGross * tBps) / BPS_DENOMINATOR;
        uint256 creatorFee = (ethInGross * cBps) / BPS_DENOMINATOR;
        uint256 net = ethInGross - fee - creatorFee;
        uint256 remaining = GRADUATION_ETH - _realEthReserves;
        if (net > remaining) {
            net = remaining;
            uint16 totBps = tBps + cBps;
            acceptedEthGross = Math.ceilDiv(net * BPS_DENOMINATOR, BPS_DENOMINATOR - totBps);
            // F-1: mirror buy()'s two-floor clamp guard so this VIEW can never revert (an underflowing
            // `ethInGross - acceptedEthGross` would panic a quote). Clamp keeps refund == 0, net == remaining.
            if (acceptedEthGross > ethInGross) acceptedEthGross = ethInGross;
            uint256 totalFee = acceptedEthGross - net;
            creatorFee = totBps == 0 ? 0 : (totalFee * cBps) / totBps;
            fee = totalFee - creatorFee;
            refund = ethInGross - acceptedEthGross;
        } else {
            acceptedEthGross = ethInGross;
        }
        tokensOut = CurveMath.buyTokensOut(_virtualEthReserves, _virtualTokenReserves, net);
        uint256 realTok = _realTokenReserves;
        if (tokensOut > realTok) tokensOut = realTok;
    }

    /// @inheritdoc IBondingCurve
    function quoteSell(uint256 tokenAmount) external view override returns (uint256 ethOut, uint256 fee) {
        if (phase != Phase.Trading || tokenAmount == 0) return (0, 0);
        uint256 gross = CurveMath.sellEthOut(_virtualEthReserves, _virtualTokenReserves, tokenAmount);
        // `fee` is the TREASURY leg; the creator leg is netted out of the seller's proceeds too.
        fee = (gross * TRADE_FEE_BPS) / BPS_DENOMINATOR;
        uint256 creatorFee = (gross * CREATOR_FEE_BPS) / BPS_DENOMINATOR;
        ethOut = gross + fee - creatorFee;
    }

    /// @inheritdoc IBondingCurve
    function reserves()
        external
        view
        override
        returns (uint256 virtualEth, uint256 virtualToken, uint256 realEth, uint256 realToken)
    {
        return (_virtualEthReserves, _virtualTokenReserves, _realEthReserves, _realTokenReserves);
    }

    // ─────────────────────────────── Internal ──────────────────────────────────

    /// @dev Low-level ETH send with a typed revert (spec §5.4 — custom errors, no revert strings).
    function _sendEth(address to, uint256 amount) private {
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert EthTransferFailed();
    }

    /// @notice Accepts ETH donations (spec §5.7). Never credited to reserves: pre-graduation
    ///         donations are swept into the migrator at graduation; the solvency invariant uses
    ///         `>=`, so a donation only ever widens the balance/reserve gap. Empty body, no phase
    ///         read — a post-graduation donation is inert (not extractable, not swept).
    receive() external payable {}
}
