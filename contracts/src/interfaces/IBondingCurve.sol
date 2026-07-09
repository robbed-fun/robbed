// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

/// @title IBondingCurve — virtual-reserve constant-product curve (spec §6.2, §6.4, §6.5;
///        contracts.md §2.3)
/// @notice One instance per token. Holds the full 1B supply at birth and all raised ETH. Fees are
///         computed HERE, in-contract — never caller-supplied (spec §4.1): 1% ETH-leg fee to
///         treasury before curve math on buys, after curve math on sells. Only the Router may call
///         trade functions; `graduate()` is permissionless.
/// @dev FROZEN interface (tests-as-spec phase). The implementation additionally exposes
///      `receive() external payable` (donations are never credited to reserves; swept into
///      graduation — contracts.md §2.3). The sell path never reads any pause flag — sells cannot
///      be paused by construction (spec §6.5, contracts.md §5.3).
///      Invariants owned (gate 2, contracts.md §2.3): k non-decreasing; balance ≥ realEthReserves;
///      every circulating amount sellable while Trading; realEthReserves ≤ GRADUATION_ETH;
///      graduation single-fire; post-graduation zero value.
interface IBondingCurve {
    // ────────────────────────────────── Types ──────────────────────────────────

    /// @notice Lifecycle (contracts.md §2.3). `ReadyToGraduate` locks BOTH directions pending
    ///         permissionless `graduate()` — a deterministic, permissionlessly-exitable protocol
    ///         state, not a pause (spec §12.12). `Graduated` is terminal: curve holds zero value,
    ///         every state-mutating function reverts.
    enum Phase {
        Trading,
        ReadyToGraduate,
        Graduated
    }

    // ────────────────────────────────── Events ─────────────────────────────────

    /// @notice Canonical trade event — cross-service contract shape ratified in spec §12.15.
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
    ///         clamp, contracts.md §2.3).
    event GraduationReady(uint256 realEthReserves);

    // ─────────────────────────────── Trading (Router-only) ─────────────────────

    /// @notice Buy tokens with ETH (net of in-contract fee). Router-only.
    /// @dev msg.value is the gross ETH. Order (contracts.md §3.2): phase check → anti-sniper
    ///      cap (timestamp window, spec §12.18 — never the L1-estimating NUMBER opcode) → fee calc → graduation
    ///      clamp → factory.recordEthDelta(+acceptedNet) (global cap) → per-token cap → curve
    ///      math → state update → CEI interactions (fee→treasury, refund→refundTo,
    ///      tokens→recipient) → Trade event → GraduationReady if crossed.
    /// @param recipient    Receives tokens.
    /// @param refundTo     Receives any graduation-clamp refund (Router passes the original payer).
    /// @param minTokensOut Slippage floor; revert SlippageExceeded if actual < min — a clamped
    ///                     fill that undershoots the min reverts, never silently partial-fills.
    /// @return tokensOut        Tokens sent to `recipient`.
    /// @return acceptedEthGross Gross ETH accepted after the graduation clamp.
    /// @return fee              In-contract fee sent to treasury.
    function buy(address recipient, address refundTo, uint256 minTokensOut)
        external
        payable
        returns (uint256 tokensOut, uint256 acceptedEthGross, uint256 fee);

    /// @notice Sell tokens for ETH. Router-only. The Router MUST transfer `tokenAmount` from the
    ///         seller to this curve in the same call, before invoking sell (internal trust,
    ///         onlyRouter).
    /// @dev Never reads pauseBuys/pauseCreates or any factory pause state — sells cannot be
    ///      paused by construction (spec §6.5). Reverts only on: phase != Trading, zero amount,
    ///      or SlippageExceeded. factory.recordEthDelta(-ethOutGross) uses non-reverting
    ///      floor-at-zero semantics.
    /// @param recipient   Receives the ETH proceeds.
    /// @param tokenAmount Tokens already transferred to the curve by the Router.
    /// @param minEthOut   Slippage floor on net ETH out.
    /// @return ethOut Net ETH paid to `recipient` (gross − fee).
    /// @return fee    In-contract fee sent to treasury.
    function sell(address recipient, uint256 tokenAmount, uint256 minEthOut)
        external
        returns (uint256 ethOut, uint256 fee);

    // ─────────────────────────────── Graduation ────────────────────────────────

    /// @notice Permissionless graduation once realEthReserves == GRADUATION_ETH
    ///         (phase ReadyToGraduate). Fires exactly once (phase is terminal).
    /// @dev Pays CALLER_REWARD (ETH) to msg.sender, transfers the curve's ENTIRE token balance
    ///      and ENTIRE ETH balance (donations included → post-grad zero-value invariant) to the
    ///      migrator, sets phase = Graduated (effect before interactions), calls
    ///      migrator.migrate. Reverts NotReady if phase != ReadyToGraduate. A migrator revert
    ///      (e.g. PoolPriceUnrecoverable) unwinds entirely, leaving the curve ReadyToGraduate
    ///      and retriable by anyone (contracts.md §3.4).
    function graduate() external;

    // ──────────────── Views (Trust panel §5.2 + Router quoting) ────────────────

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

    /// @notice Deployment timestamp (anti-sniper window anchor).
    function createdAt() external view returns (uint64);

    // ──── Immutable-parameter getters (contracts.md §2.3 storage table; public so the ────
    // ──── gate-2 handlers/tests and the Trust panel can read curve economics)          ────

    /// @notice The LaunchToken this curve sells.
    function token() external view returns (address);

    /// @notice Initial virtual ETH reserves (M0 constants).
    function VIRTUAL_ETH_0() external view returns (uint256);

    /// @notice Initial virtual token reserves (M0 constants).
    function VIRTUAL_TOKEN_0() external view returns (uint256);

    /// @notice Tokens sellable on the curve (≈793.1M e18, M0 constants).
    function CURVE_SUPPLY() external view returns (uint256);

    /// @notice LP tranche minted to V3 at graduation (≈206.9M e18, M0 constants).
    function LP_TOKEN_TRANCHE() external view returns (uint256);

    /// @notice Net-of-fee real-reserve graduation threshold (spec §12.11).
    function GRADUATION_ETH() external view returns (uint256);

    /// @notice Snapshotted trade fee in bps (≤200 guaranteed by factory).
    function TRADE_FEE_BPS() external view returns (uint16);

    /// @notice Flat graduation fee (→ treasury first at migration).
    function GRADUATION_FEE() external view returns (uint256);

    /// @notice ETH reward paid to the graduate() caller.
    function CALLER_REWARD() external view returns (uint256);

    /// @notice Anti-sniper window end: createdAt + earlyWindowSeconds (timestamp-based,
    ///         spec §12.18 — never the L1-estimating NUMBER opcode).
    function EARLY_WINDOW_END() external view returns (uint64);

    /// @notice Per-tx gross ETH buy cap inside the early window.
    function MAX_EARLY_BUY() external view returns (uint128);
}
