// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {ICreatorVault} from "./interfaces/ICreatorVault.sol";
import {ICurveFactory} from "./interfaces/ICurveFactory.sol";
import {ZeroAddress, NotCurve, NotLpFeeVault, EthTransferFailed} from "./errors/Errors.sol";

/// @title CreatorVault — pull-payment escrow for the creator-fee legs (spec §7, §12.63, §12.69)
/// @notice Per-creator escrow with two pull-payment custody tracks. No owner, no admin withdraw, no
///         upgrade path, no privileged functions — mirrors the {LPFeeVault} / §12.25 `sweepFees`
///         minimalism discipline. Four external state-mutating functions:
///           • `deposit(creator)`         — curve-only ETH credit (pre-graduation creator leg, §12.63)
///           • `claim(creator)`           — permissionless ETH payout to the creator
///           • `depositERC20(c, tok, amt)`— LPFeeVault-only ERC20 credit (post-graduation split, §12.69)
///           • `claimERC20(c, tok)`       — permissionless ERC20 payout to the creator
///         Value leaves ONLY via a `claim*`, and only ever to the address that earned it.
///
/// @dev THE load-bearing property (spec §6.5 "sells always open" / §12.25 / CLAUDE.md hard rule):
///      a hostile/reverting creator address can NEVER freeze a curve buy or sell. Proven by
///      construction across three layers:
///
///      1. **No trade path touches this contract.** The curve accrues the creator-fee leg into its
///         own `accruedCreatorFees` accumulator during `buy`/`sell` and makes NO external call for it
///         (identical discipline to the treasury leg's `accruedFees`, §12.25). Grep {BondingCurve}:
///         neither `buy` nor `sell` references the vault.
///
///      2. **The curve→vault push (`deposit`) never calls the creator.** `sweepCreatorFees()` is
///         permissionless and non-trade-path; it pushes to `deposit`, which merely accumulates into
///         `balanceOf[creator]` — a storage add that cannot revert. So the curve can always drain its
///         creator-fee escrow to the vault regardless of creator behavior (keeps the curve's
///         post-graduation zero-value invariant reachable even against a hostile creator).
///
///      3. **Only `claim` calls the creator, and a revert there is isolated + retriable.** `claim`
///         zeroes the balance before the send (CEI) under `nonReentrant`; a reverting creator reverts
///         ONLY `claim` (their own revenue, retriable once the address is fixed) — never a trade.
///
///      Design decisions recorded for the robbed-security gate:
///
///      - **`deposit` gated to factory-registered curves, `claim` fully permissionless.** Options
///        weighed: (a) fully-permissionless `deposit` — rejected: arbitrary donations would break the
///        "vault balance == Σ swept creator fees, to the wei" exact-accounting invariant (§10 gate 2)
///        and let anyone inflate a creator's balance; (b) curve-gated `deposit` via
///        `factory.isCurve(msg.sender)` — CHOSEN: keeps accounting exact and mirrors {LPFeeVault}'s
///        NPM-gated `onERC721Received`. The factory reference resolves the factory↔vault deploy cycle
///        via the established one-time-setter pattern (`CurveFactory.setCreatorVault`, exactly like
///        `setRouter`/`setMigrator`): factory deployed first, vault second (with the factory address),
///        `setCreatorVault(vault)` last.
///      - **`claim(creator)` recipient is the passed `creator`, never `msg.sender`.** Permissionless
///        in WHO pays gas, fixed in WHERE the money goes — the {LPFeeVault.collect} property. A
///        `recipient` parameter would let anyone redirect a creator's fees to themselves; rejected.
///      - **No `receive()`/`fallback()`.** Every wei enters through `deposit` and is attributed to a
///        creator on the way in, so there is never stray, unattributed ETH.
///      - **ERC20 legs (§12.69) mirror the ETH leg's discipline exactly.** `depositERC20` is gated to
///        the factory-registered LPFeeVault (the ERC20 fee source), just as `deposit` is gated to
///        factory-registered curves — so the per-`(creator, token)` balance equals the sum of
///        collect-routed shares to the wei (exact accounting, no donation pollution). It PULLS via
///        `safeTransferFrom(msg.sender=vault, ...)` (the vault approves the exact amount first), a
///        credit that cannot revert for a legit vault → a `collect()` can never be bricked here.
///        `claimERC20` pays the fixed `creator` under CEI + `nonReentrant`; a plain-ERC20 `transfer`
///        has no recipient hook (both legs are the hookless launch token and canonical WETH9), so a
///        hostile creator cannot even brick its OWN claim — strictly safer than the native-ETH leg.
contract CreatorVault is ICreatorVault, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @inheritdoc ICreatorVault
    address public immutable override factory;

    /// @inheritdoc ICreatorVault
    mapping(address creator => uint256) public override balanceOf;

    /// @inheritdoc ICreatorVault
    mapping(address creator => mapping(address token => uint256)) public override tokenBalanceOf;

    /// @param factory_ The CurveFactory whose `isCurve` registry gates `deposit`.
    constructor(address factory_) {
        if (factory_ == address(0)) revert ZeroAddress();
        factory = factory_;
    }

    /// @inheritdoc ICreatorVault
    /// @dev Curve-only (the fee source): a plain balance accumulate that cannot revert, so a curve
    ///      `sweepCreatorFees()` always clears its escrow. `creator == address(0)` is impossible from
    ///      a real curve (the curve snapshots a non-zero creator at birth) but is guarded regardless
    ///      so no wei is ever credited to the zero address.
    function deposit(address creator) external payable override {
        if (!ICurveFactory(factory).isCurve(msg.sender)) revert NotCurve();
        if (creator == address(0)) revert ZeroAddress();
        balanceOf[creator] += msg.value;
        emit CreatorFeeDeposited(creator, msg.sender, msg.value);
    }

    /// @inheritdoc ICreatorVault
    /// @dev CEI: zero the balance before the send; `nonReentrant` for defense-in-depth. A reverting
    ///      creator bubbles `EthTransferFailed` (custom error, no revert string — spec §6.7) and
    ///      leaves the balance restored by the revert, so the claim is retriable once the address is
    ///      fixed. Zero balance is a no-op send (still emits, harmlessly).
    function claim(address creator) external override nonReentrant returns (uint256 amount) {
        amount = balanceOf[creator];
        balanceOf[creator] = 0;
        if (amount != 0) {
            (bool ok,) = creator.call{value: amount}("");
            if (!ok) revert EthTransferFailed();
        }
        emit CreatorFeeClaimed(creator, msg.sender, amount);
    }

    /// @inheritdoc ICreatorVault
    /// @dev LPFeeVault-only (the post-graduation ERC20 fee source, §12.69). PULLS the exact amount the
    ///      vault approved via `safeTransferFrom`, then accumulates — cannot revert for a legit vault,
    ///      so a `collect()` split can never be frozen here. Never calls the creator (the creator is
    ///      only ever paid by `claimERC20`), so a hostile creator cannot brick a collect or a trade.
    function depositERC20(address creator, address token, uint256 amount) external override {
        if (msg.sender != ICurveFactory(factory).lpFeeVault()) revert NotLpFeeVault();
        if (creator == address(0)) revert ZeroAddress();
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        tokenBalanceOf[creator][token] += amount;
        emit CreatorTokenDeposited(creator, token, msg.sender, amount);
    }

    /// @inheritdoc ICreatorVault
    /// @dev CEI: zero the per-token balance before the send; `nonReentrant` for defense-in-depth. Pays
    ///      the fixed `creator` (never the caller). Zero balance is a no-op send (still emits).
    function claimERC20(address creator, address token) external override nonReentrant returns (uint256 amount) {
        amount = tokenBalanceOf[creator][token];
        tokenBalanceOf[creator][token] = 0;
        if (amount != 0) IERC20(token).safeTransfer(creator, amount);
        emit CreatorTokenClaimed(creator, token, msg.sender, amount);
    }
}
