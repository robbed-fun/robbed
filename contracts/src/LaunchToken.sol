// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import {IERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import {ILaunchToken} from "./interfaces/ILaunchToken.sol";

/// @title LaunchToken — ROBBED_ launch token (spec §6.1, §8.3; contracts.md §2.1)
/// @notice Plain OpenZeppelin v5 `ERC20` + `ERC20Permit`. 18 decimals. Ownerless, no
///         mint/burn/hooks/taxes/blacklist. The entire fixed supply is minted exactly once, in the
///         constructor, to the owning `BondingCurve`. The only surface beyond stock OZ is the
///         immutable `metadataHash` commitment (§8.3) and the `TOTAL_SUPPLY` getter.
/// @dev Implements the frozen {ILaunchToken}. Design decisions (recorded for the security gate):
///
///      1. Ownerless by construction — the contract inherits NO access-control mixin (`Ownable`/
///         `AccessControl` are not imported). Chosen over "inherit Ownable and renounce" because
///         renouncement is a post-deploy runtime action that can be forgotten or front-run, whereas
///         "no owner code at all" is a compile-time guarantee with a smaller attack surface (spec
///         §6.1 "ownerless"; §6.6 "owner can never touch token economics"). Proven by the unit test
///         asserting the `owner()` selector is absent (reverts).
///
///      2. No `burn()`/`_burn`, no `mint()` beyond the single constructor `_mint`. OZ ERC20 exposes
///         no public mint/burn; we add none. Graduation "dust burn" (spec §12.13) is a plain
///         `transfer` to `0x…dEaD` performed by the migrator — the token itself is burn-free, so
///         `totalSupply()` is constant `1e27` forever (contracts.md §2.1 invariant). Proven by unit
///         tests calling the `mint`/`burn` selectors and asserting they are not present.
///
///      3. `metadataHash` is `immutable`, set once in the constructor. Chosen over a storage
///         variable to make tamper-impossibility a bytecode property (no SSTORE path exists),
///         matching the §8.3 integrity-commitment requirement.
///
///      4. `ERC20Permit(name_)` fixes the EIP-712 domain `version` to `"1"` (OZ v5 default) and uses
///         the token name as the domain name — the standard EIP-2612 layout wagmi/viem expect, so
///         `sellWithPermit` (Router, M1-9) and any wallet-side permit signing interoperate without a
///         bespoke domain. Verified by the permit unit test signing and spending an allowance.
///
///      Emits no events of its own; the constructor `_mint` emits the standard
///      `Transfer(address(0) → curve)`.
contract LaunchToken is ERC20, ERC20Permit, ILaunchToken {
    /// @inheritdoc ILaunchToken
    /// @dev `constant` (never an SSTORE target) — the fixed 1,000,000,000e18 supply (spec §6.4,
    ///      contracts.md §2.1). `CURVE_SUPPLY + LP_TOKEN_TRANCHE == TOTAL_SUPPLY` is asserted by the
    ///      factory/deploy script, not here (this contract owns only the supply total).
    uint256 public constant override TOTAL_SUPPLY = 1_000_000_000e18;

    /// @inheritdoc ILaunchToken
    /// @dev `immutable`: no code path can change it after construction (§8.3 commitment).
    bytes32 public immutable override metadataHash;

    /// @param name_         Token name (length validated upstream by the factory, contracts.md §2.2).
    /// @param symbol_       Ticker (length validated upstream by the factory).
    /// @param metadataHash_ keccak256 of the canonicalized metadata JSON (§8.3). Non-zero enforced by
    ///                      the factory (`ZeroMetadataHash`); stored verbatim, immutably.
    /// @param curve_        The owning BondingCurve; receives the full `TOTAL_SUPPLY` at birth.
    /// @dev Input validation (name/symbol length, non-zero hash, non-zero curve) lives in the factory
    ///      before deploy (contracts.md §2.1 "Errors: none of its own"), keeping this contract a
    ///      minimal, audit-trivial ERC20. The mint to `curve_` is the sole supply-creating action.
    constructor(string memory name_, string memory symbol_, bytes32 metadataHash_, address curve_)
        ERC20(name_, symbol_)
        ERC20Permit(name_)
    {
        metadataHash = metadataHash_;
        _mint(curve_, TOTAL_SUPPLY);
    }

    /// @inheritdoc IERC20Permit
    /// @dev Pure disambiguation override: `nonces(address)` is inherited both from `ERC20Permit`
    ///      (concrete, backed by OZ `Nonces`) and from `IERC20Permit` via {ILaunchToken}. Solidity
    ///      requires an explicit override listing both bases; behaviour is unchanged (`super`
    ///      forwards to the OZ implementation). No new storage or logic is introduced.
    function nonces(address owner) public view virtual override(ERC20Permit, IERC20Permit) returns (uint256) {
        return super.nonces(owner);
    }
}
