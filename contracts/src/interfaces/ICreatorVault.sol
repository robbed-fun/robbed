// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

/// @title ICreatorVault — pull-payment escrow for the creator-fee legs (spec §7, §12.63, §12.69)
/// @notice Per-creator escrow with TWO custody tracks, both pull-payment:
///         (1) **ETH leg** (§12.63) — bonding curves accrue the pre-graduation creator-fee leg
///             in-contract and push native ETH here via a permissionless, non-trade-path
///             `sweepCreatorFees()` (never during a buy/sell — §12.25 discipline); the creator (or
///             anyone, on their behalf) pulls it via `claim(creator)`.
///         (2) **ERC20 legs** (§12.69) — the {LPFeeVault} splits the graduated V3 pool's fees 50/50
///             and routes the creator's part-token / part-WETH share here via `depositERC20`, credited
///             per `(creator, token)`; the creator pulls each token via `claimERC20(creator, token)`.
///         No owner, no admin withdraw, no upgrade path — value leaves ONLY via `claim`/`claimERC20`,
///         and only ever to the address that earned it. A hostile/reverting creator can freeze
///         nothing but its OWN claim: the trade path never touches this contract, and neither push
///         (`deposit`/`depositERC20`) calls the creator — only the claim functions do.
/// @dev Modeled on {ILPFeeVault} (terminal, single-purpose, minimal surface, fixed destinations).
///      ADDITIVE to the frozen interface set — introduced by the §12.63/§12.69 creator-fee decisions,
///      the same sanctioned decision-driven path by which §12.25 reconciled {IBondingCurve}.
interface ICreatorVault {
    /// @notice A curve credited `amount` of accrued creator fees to `creator` (the sweep landing).
    /// @param creator The token creator earning the fee.
    /// @param curve   The BondingCurve that swept the fee (the fee source; `msg.sender`).
    /// @param amount  Wei credited to the creator's claimable balance.
    event CreatorFeeDeposited(address indexed creator, address indexed curve, uint256 amount);

    /// @notice `caller` withdrew a creator's full accrued balance to the creator address.
    /// @param creator The recipient of the ETH (fixed — never the caller).
    /// @param caller  Whoever triggered the permissionless claim (pays gas only).
    /// @param amount  Wei paid out to `creator`.
    event CreatorFeeClaimed(address indexed creator, address indexed caller, uint256 amount);

    /// @notice The LPFeeVault credited `creator` with `amount` of `token` (a post-graduation collect
    ///         split landing, spec §12.69).
    /// @param creator The token creator earning the fee.
    /// @param token   The credited ERC20 (the launch token or WETH — the graduated pool's two legs).
    /// @param source  The LPFeeVault that routed the share (`msg.sender`).
    /// @param amount  ERC20 amount credited to `creator`'s claimable per-token balance.
    event CreatorTokenDeposited(address indexed creator, address indexed token, address indexed source, uint256 amount);

    /// @notice `caller` withdrew a creator's full accrued `token` balance to the creator address.
    /// @param creator The recipient of the ERC20 (fixed — never the caller).
    /// @param token   The claimed ERC20.
    /// @param caller  Whoever triggered the permissionless claim (pays gas only).
    /// @param amount  ERC20 amount paid out to `creator`.
    event CreatorTokenClaimed(address indexed creator, address indexed token, address indexed caller, uint256 amount);

    /// @notice Credit `creator`'s claimable balance with `msg.value`. Restricted to factory-registered
    ///         curves (the fee source), so the vault balance equals the sum of swept creator fees to
    ///         the wei — no external donations pollute the accounting. Cannot revert for a legit curve
    ///         (a plain accumulate), so the curve's `sweepCreatorFees()` always clears its escrow.
    function deposit(address creator) external payable;

    /// @notice Permissionless: pay `creator`'s entire accrued ETH balance to the creator address.
    ///         Anyone may call (pays gas); the money can only ever go to `creator`. CEI +
    ///         `nonReentrant`. A reverting `creator` reverts ONLY this call (retriable) — it can
    ///         never touch a curve buy/sell.
    /// @return amount Wei paid out.
    function claim(address creator) external returns (uint256 amount);

    /// @notice Credit `creator`'s claimable `token` balance with `amount` (spec §12.69). Restricted to
    ///         the factory-registered LPFeeVault (the fee source), which must have approved this vault
    ///         for `amount`; this vault pulls via `transferFrom`, so the per-token balance equals the
    ///         sum of collect-routed creator shares to the wei — no external donations pollute it.
    ///         Cannot revert for a legit LPFeeVault (a pull + accumulate), so a `collect()` can never
    ///         be bricked by the credit step. Never calls the creator.
    function depositERC20(address creator, address token, uint256 amount) external;

    /// @notice Permissionless: pay `creator`'s entire accrued `token` balance to the creator address.
    ///         Anyone may call (pays gas); the tokens can only ever go to `creator`. CEI +
    ///         `nonReentrant`. Reverts ONLY this call on a misbehaving token (retriable) — never a
    ///         curve trade or a `collect()`.
    /// @return amount ERC20 amount paid out.
    function claimERC20(address creator, address token) external returns (uint256 amount);

    /// @notice Unclaimed accrued creator-fee ETH balance for `creator`.
    function balanceOf(address creator) external view returns (uint256);

    /// @notice Unclaimed accrued creator-fee `token` balance for `creator` (spec §12.69).
    function tokenBalanceOf(address creator, address token) external view returns (uint256);

    /// @notice The CurveFactory whose `isCurve` registry gates `deposit` and whose `lpFeeVault`
    ///         gates `depositERC20` (immutable, set at deploy).
    function factory() external view returns (address);
}
