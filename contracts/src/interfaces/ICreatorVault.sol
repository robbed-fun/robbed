// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

/// @title ICreatorVault — pull-payment escrow for the Phase-2 creator-fee leg (spec §7, §12.63)
/// @notice Per-creator ETH escrow. Bonding curves accrue the creator-fee leg in-contract and push it
///         here via a permissionless, non-trade-path `sweepCreatorFees()` (never during a buy/sell —
///         spec §12.25 discipline). The creator (or anyone, on their behalf) then pulls the accrued
///         balance to the creator address via `claim(creator)`. No owner, no admin withdraw, no
///         upgrade path — the ONLY way ETH leaves is `claim`, and it can only ever go to the address
///         that earned it. This makes a hostile/reverting creator unable to freeze any curve: the
///         trade path never touches this contract, and even the curve→vault push (`deposit`) never
///         calls the creator — only `claim` does, and a revert there is the creator's own,
///         retriable, isolated problem.
/// @dev Modeled on {ILPFeeVault} (terminal, single-purpose, minimal surface, fixed destinations).
///      ADDITIVE to the frozen interface set — introduced by the §12.63 creator-fee decision, the
///      same sanctioned decision-driven path by which §12.25 reconciled {IBondingCurve}.
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

    /// @notice Credit `creator`'s claimable balance with `msg.value`. Restricted to factory-registered
    ///         curves (the fee source), so the vault balance equals the sum of swept creator fees to
    ///         the wei — no external donations pollute the accounting. Cannot revert for a legit curve
    ///         (a plain accumulate), so the curve's `sweepCreatorFees()` always clears its escrow.
    function deposit(address creator) external payable;

    /// @notice Permissionless: pay `creator`'s entire accrued balance to the creator address.
    ///         Anyone may call (pays gas); the money can only ever go to `creator`. CEI +
    ///         `nonReentrant`. A reverting `creator` reverts ONLY this call (retriable) — it can
    ///         never touch a curve buy/sell.
    /// @return amount Wei paid out.
    function claim(address creator) external returns (uint256 amount);

    /// @notice Unclaimed accrued creator-fee balance for `creator`.
    function balanceOf(address creator) external view returns (uint256);

    /// @notice The CurveFactory whose `isCurve` registry gates `deposit` (immutable, set at deploy).
    function factory() external view returns (address);
}
