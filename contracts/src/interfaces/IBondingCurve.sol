// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

/// @title IBondingCurve — virtual-reserve constant-product curve (,
/// contracts.md)
/// @notice One instance per token. Holds the full 1B supply at birth and all raised ETH. Fees are
/// computed HERE, in-contract — never caller-supplied : a 1% ETH-leg fee accrues
///         to the `accruedFees` escrow on BOTH directions (before curve math on buys, after curve
///         math on sells) and is later pulled to the treasury via the permissionless `sweepFees()`
/// — NO trade path ever calls the treasury (pull-payment). Only the Router may
///         call trade functions; `graduate()` is permissionless.
/// @dev FROZEN interface (tests-as-spec phase). The implementation additionally exposes
///      `receive() external payable` (donations are never credited to reserves; swept into
/// graduation — contracts.md). The sell path never reads any pause flag — sells cannot
/// be paused by construction (contracts.md).
/// Invariants owned (gate 2, contracts.md) k non-decreasing; balance ≥ realEthReserves;
///      every circulating amount sellable while Trading; realEthReserves ≤ GRADUATION_ETH;
///      graduation single-fire; post-graduation zero value.
interface IBondingCurve {
    // ────────────────────────────────── Types ──────────────────────────────────

    /// @notice Lifecycle (contracts.md). `ReadyToGraduate` locks BOTH directions pending
    ///         permissionless `graduate()` — a deterministic, permissionlessly-exitable protocol
    /// state, not a pause. `Graduated` is terminal: curve holds zero value,
    ///         every state-mutating function reverts.
    enum Phase {
        Trading,
        ReadyToGraduate,
        Graduated
    }

    // ────────────────────────────────── Events ─────────────────────────────────

    /// @notice Canonical trade event — cross-service contract shape ratified in.
    ///         `ethAmount` is GROSS; reserve fields are POST-TRADE (stateless candle/progress
    ///         indexing for Ponder).
    event Trade(
        address indexed trader,
        bool indexed isBuy,
        uint256 ethAmount,
        uint256 tokenAmount,
        uint256 fee,
        uint256 virtualEthReserves,
        uint256 virtualTokenReserves,
        uint256 realEthReserves
    );

    /// @notice Emitted by the buy that lands exactly on GRADUATION_ETH (graduation-boundary
    /// clamp, contracts.md).
    event GraduationReady(uint256 realEthReserves);

    /// @notice Pull-payment sweep of accrued ETH-leg trade fees to the live treasury.
    ///         `treasury` is read live from the factory at sweep time.
    event FeesSwept(address indexed treasury, uint256 amount);

    /// @notice Pull-payment sweep of accrued creator-fee-leg ETH to the CreatorVault, credited to
    /// this curve's `creator`. Permissionless, non-trade-path. Only emitted
    ///         on curves with a non-zero `CREATOR_FEE_BPS`; at 0 the creator leg is inert.
    event CreatorFeesSwept(address indexed creator, address indexed vault, uint256 amount);

    // ─────────────────────────────── Trading (Router-only) ─────────────────────

    /// @notice Buy tokens with ETH (net of in-contract fee). Router-only.
    /// @dev msg.value is the gross ETH. Order (contracts.md) phase check → anti-sniper
    /// cap (timestamp window, — never the L1-estimating NUMBER opcode) → fee calc → graduation
    ///      clamp → factory.recordEthDelta(+acceptedNet) (global cap) → per-token cap → curve
    ///      math → state update (fee accrues to `accruedFees`, NO treasury call — pull-payment,
    /// ) → CEI interactions (refund→refundTo, tokens→recipient) → Trade event →
    ///      GraduationReady if crossed. The treasury pulls its fees separately via `sweepFees()`.
    /// @param trader       The originating EOA (Router forwards msg.sender) — emitted as
    /// `Trade.trader` (finding X-3). Event-only; carries no authority.
    /// @param recipient    Receives tokens.
    /// @param refundTo     Receives any graduation-clamp refund (Router passes the original payer).
    /// @param minTokensOut Slippage floor; revert SlippageExceeded if actual < min — a clamped
    ///                     fill that undershoots the min reverts, never silently partial-fills.
    /// @return tokensOut        Tokens sent to `recipient`.
    /// @return acceptedEthGross Gross ETH accepted after the graduation clamp.
    /// @return fee              In-contract fee accrued to `accruedFees` (NOT pushed to treasury,
    /// ).
    function buy(address trader, address recipient, address refundTo, uint256 minTokensOut)
        external
        payable
        returns (uint256 tokensOut, uint256 acceptedEthGross, uint256 fee);

    /// @notice Sell tokens for ETH. Router-only. The Router MUST transfer `tokenAmount` from the
    ///         seller to this curve in the same call, before invoking sell (internal trust,
    ///         onlyRouter).
    /// @dev Never reads pauseBuys/pauseCreates or any factory pause state, and NEVER calls the
    /// treasury — the fee accrues to `accruedFees`. Sells cannot be paused or frozen
    /// by construction. Reverts only on: phase != Trading, zero amount, or
    ///      SlippageExceeded. factory.recordEthDelta(-ethOutGross) uses non-reverting
    ///      floor-at-zero semantics.
    /// @param trader      The seller EOA (Router forwards msg.sender) — emitted as `Trade.trader`.
    /// @param recipient   Receives the ETH proceeds.
    /// @param tokenAmount Tokens already transferred to the curve by the Router.
    /// @param minEthOut   Slippage floor on net ETH out.
    /// @return ethOut Net ETH paid to `recipient` (gross − fee).
    /// @return fee In-contract fee accrued to `accruedFees` (NOT pushed to treasury).
    function sell(address trader, address recipient, uint256 tokenAmount, uint256 minEthOut)
        external
        returns (uint256 ethOut, uint256 fee);

    // ─────────────────────────── Fee escrow ───────────────────────────

    /// @notice Permissionless, non-phase-gated pull-payment of accrued ETH-leg trade fees to the
    /// treasury (resolves threat-model UM-1).
    /// @dev Reads `treasury` live from the factory, zeroes `accruedFees` first (CEI), then sends
    ///      the amount via a low-level call (reverts EthTransferFailed on failure). `nonReentrant`.
    ///      Works in EVERY phase including Graduated, so fees withheld at graduation stay
    ///      claimable. Touches NO curve reserve. A reverting treasury reverts ONLY this call
    ///      (retriable) — it can never block a buy or a sell, which is the whole point: no trade
    ///      path calls the treasury.
    /// @return swept The amount sent to the treasury.
    function sweepFees() external returns (uint256 swept);

    /// @notice Permissionless, non-phase-gated pull-payment of accrued creator-fee-leg ETH to the
    /// CreatorVault, credited to this curve's `creator`.
    /// @dev Mirrors {sweepFees}: zeroes `accruedCreatorFees` first (CEI), then pushes to
    ///      `ICreatorVault(creatorVault).deposit{value}(creator)`. `nonReentrant`. Works in EVERY
    ///      phase including Graduated. The vault `deposit` is a trusted, non-reverting accumulate, so
    ///      this ALWAYS clears the escrow regardless of creator behavior — a hostile creator can only
    ///      ever revert their own downstream {ICreatorVault.claim}, never this sweep and never a
    ///      trade. Touches NO curve reserve. No-op (sends nothing) when `CREATOR_FEE_BPS == 0`.
    /// @return swept The amount deposited to the vault for the creator.
    function sweepCreatorFees() external returns (uint256 swept);

    // ─────────────────────────────── Graduation ────────────────────────────────

    /// @notice Permissionless graduation once realEthReserves == GRADUATION_ETH
    ///         (phase ReadyToGraduate). Fires exactly once (phase is terminal).
    /// @dev Pays CALLER_REWARD (ETH) to msg.sender, transfers the curve's ENTIRE token balance
    ///      and ENTIRE ETH balance (donations included → post-grad zero-value invariant) to the
    ///      migrator, sets phase = Graduated (effect before interactions), calls
    ///      migrator.migrate. Reverts NotReady if phase != ReadyToGraduate. A migrator revert
    ///      (e.g. PoolPriceUnrecoverable) unwinds entirely, leaving the curve ReadyToGraduate
    /// and retriable by anyone (contracts.md).
    function graduate() external;

    // ──────────────── Views (Trust panel + Router quoting) ────────────────

    /// @notice Quote a gross-ETH buy, including graduation-clamp effects.
    function quoteBuy(uint256 ethInGross)
        external
        view
        returns (uint256 tokensOut, uint256 fee, uint256 acceptedEthGross, uint256 refund);

    /// @notice Quote a token sell (net ETH out and fee).
    function quoteSell(uint256 tokenAmount) external view returns (uint256 ethOut, uint256 fee);

    /// @notice Current reserves. `realToken` = tokens still available for sale.
    function reserves()
        external
        view
        returns (uint256 virtualEth, uint256 virtualToken, uint256 realEth, uint256 realToken);

    /// @notice Current lifecycle phase.
    function phase() external view returns (Phase);

    /// @notice Unswept treasury-leg trade fees held in escrow. Solvency holds
    ///         `address(this).balance >= realEthReserves + accruedFees + accruedCreatorFees` at all
    /// times (the -extended form; at `CREATOR_FEE_BPS == 0` the creator term is 0 and
    /// this reduces to the form).
    function accruedFees() external view returns (uint256);

    /// @notice Unswept creator-leg fees held in escrow. Always 0 while
    ///         `CREATOR_FEE_BPS == 0`. Swept to the CreatorVault by {sweepCreatorFees}.
    function accruedCreatorFees() external view returns (uint256);

    /// @notice Deployment timestamp (anti-sniper window anchor).
    function createdAt() external view returns (uint64);

    // ──── Immutable-parameter getters (contracts.md storage table; public so the ────
    // ──── gate-2 handlers/tests and the Trust panel can read curve economics)          ────

    /// @notice The LaunchToken this curve sells.
    function token() external view returns (address);

    /// @notice The token creator — beneficiary of the creator-fee leg. Snapshotted
    ///         at creation; event-only authority (carries no admin power over the curve).
    function creator() external view returns (address);

    /// @notice The CreatorVault this curve sweeps its creator-fee leg to. Snapshotted
    ///         at creation; may be address(0) on a curve created with `CREATOR_FEE_BPS == 0`.
    function creatorVault() external view returns (address);

    /// @notice Creator-fee leg in bps. Snapshotted; `TRADE_FEE_BPS + CREATOR_FEE_BPS
    ///         ≤ 200` guaranteed by the factory. 0 on v1/mainnet curves.
    function CREATOR_FEE_BPS() external view returns (uint16);

    /// @notice Initial virtual ETH reserves (M0 constants).
    function VIRTUAL_ETH_0() external view returns (uint256);

    /// @notice Initial virtual token reserves (M0 constants).
    function VIRTUAL_TOKEN_0() external view returns (uint256);

    /// @notice Tokens sellable on the curve (≈793.1M e18, M0 constants).
    function CURVE_SUPPLY() external view returns (uint256);

    /// @notice LP tranche minted to V3 at graduation (≈206.9M e18, M0 constants).
    function LP_TOKEN_TRANCHE() external view returns (uint256);

    /// @notice Net-of-fee real-reserve graduation threshold.
    function GRADUATION_ETH() external view returns (uint256);

    /// @notice Snapshotted trade fee in bps (≤200 guaranteed by factory).
    function TRADE_FEE_BPS() external view returns (uint16);

    /// @notice Flat graduation fee (→ treasury first at migration).
    function GRADUATION_FEE() external view returns (uint256);

    /// @notice ETH reward paid to the graduate() caller.
    function CALLER_REWARD() external view returns (uint256);

    /// @notice Anti-sniper window end: createdAt + earlyWindowSeconds (timestamp-based,
    /// — never the L1-estimating NUMBER opcode).
    function EARLY_WINDOW_END() external view returns (uint64);

    /// @notice Per-tx gross ETH buy cap inside the early window.
    function MAX_EARLY_BUY() external view returns (uint128);
}
